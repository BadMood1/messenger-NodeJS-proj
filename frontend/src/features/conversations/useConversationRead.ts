import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { ApiRequestError, isTemporaryRequestError } from "../../lib/api-request-error";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { VisibleMessagePosition } from "../messages/useLastVisibleMessage";
import { markConversationRead, type ConversationReadState } from "./conversations.api";

// ------- КАК СОХРАНЯЕТСЯ ПРОЧТЕНИЕ -------
// 1. useLastVisibleMessage определяет видимую позицию; MessengerPage передаёт её в этот хук.
// 2. queueVisibleMessageForRead сохраняет самую новую увиденную позицию в pendingPosition
//    соответствующего чата и вызывает scheduleRead. Очередь живёт до выхода пользователя из Messenger.
// 3. scheduleRead ставит один таймер: следующий запрос разрешён через 2 с от начала предыдущего.
//    Первый запрос не ждёт этот интервал; пока выполняется PATCH, следующий не планируем.
// 4. По таймеру sendReadPosition выбирает готовый чат и запоминает его позицию в positionToSend.
//    pendingPosition остаётся в очереди; новые увиденные сообщения могут сдвинуть её вперёд.
// 5. markConversationRead получает conversationId и positionToSend.messageId;
//    через authenticatedRequest отправляет PATCH /conversations/:conversationId/read.
// 6. Backend возвращает readState -> сохраняем его в confirmedPosition и убираем покрытую позицию.
//    В finally снова вызываем scheduleRead: если накопилась новая позиция, сохраняем и её.
// Сетевой сбой или временный HTTP-отказ -> повтор через 2/4/8/16/30 с, без ошибки возле composer.
// Offline приостанавливает отправку; online/reconnect возобновляет её. Смена чата очередь не очищает.

const READ_INTERVAL_MS = 2000;
const MAX_RETRY_DELAY_MS = 30_000;
const READ_REQUEST_TIMEOUT_MS = 10_000;

type ReadPosition = { messageId: string | null; createdAt: string };
type ConversationReadProgress = {
    pendingPosition: VisibleMessagePosition | null;
    confirmedPosition: ReadPosition | null;
    retryAttempt: number; // кол-во последовательных временных ошибок
    requestAllowedAt: number; // время, начиная с которого разрешён запрос прочтения этого чата
    rejectedMessageId: string | null; // id, который сервер окончательно отклонил
    isAccessDenied: boolean; // сервер отказал в доступе к этому чату
};

type UseConversationReadOptions = {
    conversationId: string | null;
    currentUserId: string | null;
    lastVisibleMessage: VisibleMessagePosition | null;
    initialReadState: ConversationReadState | null;
    authenticatedRequest: AuthenticatedRequest;
    isEnabled: boolean;
};

type ReadActions = {
    queueVisibleMessageForRead: (message: VisibleMessagePosition | null) => void;
    resumeReadPositionSync: () => void;
};

// Получает сравниваемую позицию и уже известную границу.
// Сравнивает дату, затем id при одинаковой дате.
// Возвращает true, только если сообщение находится после границы.
const isMessageAfterPosition = (message: ReadPosition, position: ReadPosition | null) => {
    if (!position) return true;
    const dateDifference = Date.parse(message.createdAt) - Date.parse(position.createdAt);
    if (dateDifference !== 0) return dateDifference > 0;
    // Если даты одинаковые
    if (message.messageId === null || position.messageId === null) return false; // для TS
    return message.messageId > position.messageId;
};

// Получает пользователя, открытый чат, видимую позицию и функцию защищённых запросов.
// Сохраняет очереди прочтения всех посещённых чатов и повторяет временные ошибки в фоне.
// Возвращает обработчик восстановления связи; сообщения и состояние истории не меняет.
export const useConversationRead = (options: UseConversationReadOptions) => {
    const {
        conversationId,
        currentUserId,
        lastVisibleMessage,
        initialReadState,
        authenticatedRequest,
        isEnabled,
    } = options;
    const contextRef = useRef(options);
    // хранит обработчики очереди текущего пользователя
    const readActionsRef = useRef<ReadActions | null>(null);

    useLayoutEffect(() => {
        contextRef.current = options;
    }, [options]);

    // ------- ОДНА ОЧЕРЕДЬ ДЛЯ ВСЕХ ЧАТОВ ПОЛЬЗОВАТЕЛЯ -------
    useEffect(() => {
        if (!isEnabled || !currentUserId) return;

        // ключ - conversationId, хранит состояния сохранения прочтения одного диалога
        const progressByConversationId = new Map<string, ConversationReadProgress>();

        let isReadSyncStopped = false;
        let timerId: number | null = null;
        let scheduledReadAt = 0; // в какое время сработает таймер
        let requestController: AbortController | null = null;
        // Время начала последнего сохранения
        let lastRequestStartedAt = 0;

        // Вызывается перед отправкой запроса и применением его ответа.
        // Проверяет, что очередь ещё принадлежит текущему авторизованному пользователю.
        // Возвращает false после выхода из Messenger или смены пользователя.
        const isReadSyncActive = () =>
            !isReadSyncStopped &&
            contextRef.current.isEnabled &&
            contextRef.current.currentUserId === currentUserId;

        // Получает id чата.
        // Находит его очередь или создаёт пустую запись.
        // Возвращает ожидающую позицию, подтверждение и параметры повтора этого чата.
        const getConversationReadProgress = (queuedConversationId: string) => {
            let progress = progressByConversationId.get(queuedConversationId);
            if (!progress) {
                progress = {
                    pendingPosition: null,
                    confirmedPosition: null,
                    retryAttempt: 0,
                    requestAllowedAt: 0,
                    rejectedMessageId: null,
                    isAccessDenied: false,
                };
                progressByConversationId.set(queuedConversationId, progress);
            }
            return progress;
        };

        // Получает сохранённую backend границу из GET или PATCH.
        // Сдвигает известное подтверждение только вперёд и убирает уже прочитанную ожидающую позицию.
        // Сохраняет результат в очереди нужного чата.
        const rememberConfirmedReadPosition = (readState: ConversationReadState | null) => {
            if (!readState?.lastReadMessageCreatedAt || readState.userId !== currentUserId) return;
            const progress = getConversationReadProgress(readState.conversationId);
            const savedPosition = {
                messageId: readState.lastReadMessageId,
                createdAt: readState.lastReadMessageCreatedAt,
            };
            // Проверяем и обновляем подтвержденную границу
            if (isMessageAfterPosition(savedPosition, progress.confirmedPosition)) {
                progress.confirmedPosition = savedPosition;
            }
            // Если backend подтвердил прочтение до ожидающей позиции или дальше,
            // убираем её из очереди: повторный PATCH для неё не нужен.
            if (
                progress.pendingPosition &&
                !isMessageAfterPosition(progress.pendingPosition, progress.confirmedPosition)
            ) {
                progress.pendingPosition = null;
            }
        };

        // Вызывается перед планированием и отправкой PATCH.
        // Среди чатов с ожидающей позицией выбирает ближайшее время попытки.
        // Возвращает выбранный чат; ошибка одного чата не задерживает остальные.
        const findNextConversationToSave = () => {
            let nextConversation: { conversationId: string; progress: ConversationReadProgress } | null =
                null;
            for (const [queuedConversationId, progress] of progressByConversationId) {
                if (
                    !progress.isAccessDenied &&
                    progress.pendingPosition &&
                    (!nextConversation ||
                        progress.requestAllowedAt < nextConversation.progress.requestAllowedAt)
                ) {
                    nextConversation = { conversationId: queuedConversationId, progress };
                }
            }
            return nextConversation;
        };

        // ------- ОДИН ТАЙМЕР И ОДИН ЗАПРОС -------
        // Вызывается после появления кандидата, завершения PATCH или восстановления связи.
        // Ставит таймер с учётом двухсекундного интервала и задержки после ошибки.
        // Сохраняет таймер при том же времени; если ближайшая попытка сместилась — переставляет его.
        const scheduleRead = () => {
            if (
                !isReadSyncActive() ||
                requestController ||
                !navigator.onLine || // navigator — объект браузера; onLine=false — браузер сообщает, что сети нет
                document.hidden ||
                !document.hasFocus()
            )
                return;
            const nextConversation = findNextConversationToSave();
            if (!nextConversation) return;

            // интервал от начала предыд. PATCH  / когда закончится задержка Повторной попытки Этого чата
            const sendAt = Math.max(
                lastRequestStartedAt + READ_INTERVAL_MS,
                nextConversation.progress.requestAllowedAt,
            );
            // таймер уже назначен на нужное время, оставляем его
            if (timerId !== null && scheduledReadAt === sendAt) return;
            // если расчётное время изменилось, сразу заменяем таймер
            if (timerId !== null) window.clearTimeout(timerId);
            scheduledReadAt = sendAt;
            timerId = window.setTimeout(sendReadPosition, Math.max(0, sendAt - Date.now()));
        };

        // Вызывается таймером в разрешённый момент отправки.
        // Отправляет уже увиденную позицию выбранного чата, даже если пользователь открыл другой.
        // При успехе запоминает ответ backend, при временной ошибке назначает фоновый повтор.
        const sendReadPosition = async () => {
            timerId = null;
            if (
                !isReadSyncActive() ||
                requestController ||
                !navigator.onLine || // navigator — объект браузера; onLine=false — браузер сообщает, что сети нет
                document.hidden ||
                !document.hasFocus()
            )
                return;
            const nextConversation = findNextConversationToSave();
            if (!nextConversation) return;
            // если для выбранного кандидата ещё рано - заново планируем таймер
            if (
                Math.max(
                    lastRequestStartedAt + READ_INTERVAL_MS,
                    nextConversation.progress.requestAllowedAt,
                ) > Date.now()
            ) {
                scheduleRead();
                return;
            }
            // : ... - переименовывает переменную при деструктуризации
            const { conversationId: queuedConversationId, progress } = nextConversation;
            const positionToSend = progress.pendingPosition;
            if (!positionToSend) return;
            const controller = new AbortController();
            requestController = controller; // controller именно для конкретного запроса
            lastRequestStartedAt = Date.now();
            // Зависший PATCH через 10 с освобождает очередь; его позицию затем повторим в фоне.
            const requestTimeoutId = window.setTimeout(() => {
                controller.abort(new DOMException("Read position request timed out", "TimeoutError"));
            }, READ_REQUEST_TIMEOUT_MS);

            try {
                // получаем сохр. backend границу
                const readState = await markConversationRead(
                    queuedConversationId,
                    positionToSend.messageId,
                    authenticatedRequest,
                    { signal: controller.signal },
                );
                if (!isReadSyncActive() || controller.signal.aborted) return;

                // Сохр. в Map
                // Backend мог вернуть более новую границу от другой вкладки — используем его ответ, не отправленный id.
                rememberConfirmedReadPosition(readState);
                progress.retryAttempt = 0;
                progress.requestAllowedAt = Date.now(); // ожидания для этого чата нет, можно отправлять markConversationRead
            } catch (error) {
                // различаем обычную отмену и зависание
                const didRequestTimeOut =
                    controller.signal.reason instanceof DOMException &&
                    controller.signal.reason.name === "TimeoutError";
                if (!isReadSyncActive() || (controller.signal.aborted && !didRequestTimeOut)) return;
                // При временной ошибке фоновый повтор
                if (didRequestTimeOut || isTemporaryRequestError(error)) {
                    // Позиция остаётся в Map, в том числе если во время запроса увидели более новую.
                    progress.retryAttempt = Math.min(progress.retryAttempt + 1, 5);
                    const retryDelay = Math.min(
                        READ_INTERVAL_MS * 2 ** (progress.retryAttempt - 1), // 2,4,8,16,30
                        MAX_RETRY_DELAY_MS,
                    );
                    progress.requestAllowedAt = Date.now() + retryDelay;
                } else {
                    // Если доступ запрещён, прекращаем отправку всего чата, а не только одного messageId.
                    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
                        progress.isAccessDenied = true;
                        progress.pendingPosition = null;
                    }
                    // Этот id сервер отклонил окончательно: не повторяем его при каждом новом замере observer.
                    // Может быть например если удалили сообщ. и вернёт 404
                    progress.rejectedMessageId = positionToSend.messageId;
                    // очищает ожидание если там все ещё rejected наше
                    if (progress.pendingPosition?.messageId === positionToSend.messageId)
                        progress.pendingPosition = null;
                    const visibleMessage = contextRef.current.lastVisibleMessage;
                    if (
                        error instanceof ApiRequestError &&
                        error.status === 404 &&
                        visibleMessage?.conversationId === queuedConversationId
                    ) {
                        // Пробуем другое видимое поставить в очередь
                        queueVisibleMessageForRead(visibleMessage);
                    }
                    if (import.meta.env.DEV) console.debug("[read] Position was not saved:", error);
                }
            } finally {
                window.clearTimeout(requestTimeoutId);
                // снимаем признак выполняющегося запроса, если ссылка все ещё относится к нашему controller
                if (requestController === controller) requestController = null;
                if (isReadSyncActive()) scheduleRead();
            }
        };

        // ------- НАКОПЛЕНИЕ ВИДИМЫХ ПОЗИЦИЙ -------
        // Получает очередную видимую позицию из useLastVisibleMessage.
        // Сохраняет самую новую увиденную позицию, которая ещё не подтверждена backend.
        // Планирует отправку
        const queueVisibleMessageForRead = (message: VisibleMessagePosition | null) => {
            if (!isReadSyncActive()) return;
            // Начинаем с границы из GET conversations: уже прочитанные сообщения повторно не отправляем.
            rememberConfirmedReadPosition(contextRef.current.initialReadState);
            if (
                message &&
                message.conversationId === contextRef.current.conversationId &&
                !document.hidden &&
                document.hasFocus()
            ) {
                const progress = getConversationReadProgress(message.conversationId);
                // Решаем нужно ли обновл. ожидание
                if (
                    !progress.isAccessDenied &&
                    message.messageId !== progress.rejectedMessageId &&
                    isMessageAfterPosition(message, progress.confirmedPosition) &&
                    (!progress.pendingPosition || isMessageAfterPosition(message, progress.pendingPosition))
                ) {
                    // if сработал = дальше scheduleRead решит, когда отправ. PATCH
                    if (!progress.pendingPosition) progress.requestAllowedAt = Date.now();
                    progress.pendingPosition = message; // заменяем на более новое сообщ.(выше проверяем, что это так 100% )
                }
            }
            scheduleRead();
        };

        // ------- ВОССТАНОВЛЕНИЕ СВЯЗИ И АКТИВНОСТИ ВКЛАДКИ -------
        // Вызывается после browser online или успешного socket connect/reconnect.
        // Разрешает повтор накопленных позиций без ожидания старой задержки ошибки.
        // Планирует один PATCH, сохраняя общий двухсекундный интервал.
        const resumeReadPositionSync = () => {
            if (!isReadSyncActive()) return;
            for (const progress of progressByConversationId.values()) {
                progress.retryAttempt = 0;
                progress.requestAllowedAt = 0;
            }
            scheduleRead();
        };

        // Вызывается при offline, blur, focus и смене видимости вкладки.
        // Приостанавливает таймер без очистки очереди, пока вкладка неактивна или сети нет.
        // После возвращения планирует сохранение уже увиденных позиций.
        const handleReadSyncActivity = () => {
            if (!navigator.onLine || document.hidden || !document.hasFocus()) {
                // Если вкладка скрылась или потеряла фокус, отменяем ожид. таймер
                // При focus мы сделаем scheduleRead и там создастся новый таймер, запустится выполнение
                if (timerId !== null) window.clearTimeout(timerId);
                timerId = null;
            } else scheduleRead();
        };

        // --- НАЧИНАЕМ РАБОТУ ---
        const actions = { queueVisibleMessageForRead, resumeReadPositionSync };
        readActionsRef.current = actions;
        window.addEventListener("online", resumeReadPositionSync);
        window.addEventListener("offline", handleReadSyncActivity);
        window.addEventListener("focus", handleReadSyncActivity);
        window.addEventListener("blur", handleReadSyncActivity);
        document.addEventListener("visibilitychange", handleReadSyncActivity);
        queueVisibleMessageForRead(contextRef.current.lastVisibleMessage);

        return () => {
            // Cleanup завершает работу для старого пользователя; смена чата очередь не пересоздаёт.
            isReadSyncStopped = true;
            if (timerId !== null) window.clearTimeout(timerId);
            requestController?.abort();
            window.removeEventListener("online", resumeReadPositionSync);
            window.removeEventListener("offline", handleReadSyncActivity);
            window.removeEventListener("focus", handleReadSyncActivity);
            window.removeEventListener("blur", handleReadSyncActivity);
            document.removeEventListener("visibilitychange", handleReadSyncActivity);
            if (readActionsRef.current === actions) readActionsRef.current = null;
        };
    }, [currentUserId, authenticatedRequest, isEnabled]);

    // Связываем очередь с остальным приложением:

    // Новая видимая позиция дополняет очередь, но не пересоздаёт таймер и текущий PATCH.
    useEffect(() => {
        readActionsRef.current?.queueVisibleMessageForRead(lastVisibleMessage);
    }, [conversationId, initialReadState, lastVisibleMessage]);

    // Получает сигнал успешного reconnect из MessengerPage.
    // Передаёт его очереди текущего пользователя.
    // Возобновляет фоновое сохранение, не меняя сообщения и скролл.
    const resumeReadPositionSync = useCallback(() => readActionsRef.current?.resumeReadPositionSync(), []);
    return { resumeReadPositionSync };
};
