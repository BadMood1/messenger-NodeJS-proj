import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { applyKnownMessageChanges, mergeMessage, reconcileMessageHistory } from "./message-state-updates";
import { reloadMessageHistory } from "./reload-message-history";
import { useMessageScrollPosition } from "./useMessageScrollPosition";
import {
    deleteMessage as deleteMessageRequest,
    editMessage as editMessageRequest,
    getMessages,
    sendMessage as sendMessageRequest,
    type Message,
    type ClientMessage,
    type MessageSender,
    type MessageDeletedEvent,
    type MessageHistoryCursor,
} from "./messages.api";

type HistoryPageDirection = "older" | "newer" | "latest";

type UseConversationMessagesOptions = {
    conversationId: string | null;
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
    currentUser: MessageSender | null;
};

export const useConversationMessages = ({
    conversationId,
    enabled,
    authenticatedRequest,
    currentUser,
}: UseConversationMessagesOptions) => {
    // Показывает, какому чату принадлежат сообщ-я, находящиеся сейчас в messages.
    // Чтобы не показывать с другого чата при смене его
    const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ClientMessage[]>([]);
    const messagesRef = useRef(messages); // текущий список для стабильного обработчика reconnect
    // Id сообщ., которые прямо сейчас отправляются
    const sendingIdsRef = useRef(new Set<string>());
    const historyVersionRef = useRef(0);
    const initialLoadingRef = useRef(true);
    const receivedDuringLoadRef = useRef<Message[]>([]); // события, пришедшие пока initial GET ещё ждёт ответа
    // Помним удаления в текущем чате, чтобы запоздавший GET/socket не вернул сообщение или его цитату.
    const deletedMessageIdsRef = useRef(new Set<string>());
    // Хранит правки сообщений
    const editedMessagesRef = useRef(new Map<string, Message>());
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);
    const [historySyncError, setHistorySyncError] = useState<string | null>(null);
    const [historySyncRequest, setHistorySyncRequest] = useState<{
        conversationId: string;
        historyVersion: number;
    } | null>(null);
    // контроллер сверки истории после reconnect
    const historySyncControllerRef = useRef<AbortController | null>(null);

    // ------- ГРАНИЦЫ ОКНА И ЗАГРУЗКА СТРАНИЦ -------
    // Курсоры не рисуем: используем их только для следующих запросов.
    const historyCursorsRef = useRef<{
        olderCursor: MessageHistoryCursor | null;
        newerCursor: MessageHistoryCursor | null;
    }>({ olderCursor: null, newerCursor: null });
    // ID сообщения, перед которым рисуем Unread messages.
    const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
    // Что сейчас загружаем: older, newer, latest либо ничего — null.
    const [loadingDirection, setLoadingDirection] = useState<HistoryPageDirection | null>(null);
    const [paginationError, setPaginationError] = useState<{
        direction: HistoryPageDirection;
        message: string;
    } | null>(null);
    // Новые socket-сообщения ждут, пока догрузим промежуток до конца переписки.
    const deferredMessagesRef = useRef(new Map<string, Message>());
    // Намерение перейти к концу переписки после собственной отправки.
    const latestWindowRequestedRef = useRef(false);

    const conversationIdRef = useRef(conversationId); // актуальный ID
    // контроллер запроса следующей страницы вверх/вниз
    const paginationControllerRef = useRef<AbortController | null>(null); // отменяет страницу и не даёт запустить две одновременно

    // useLayoutEffect выполняется раньше обычного useEffect — сразу после того, как
    // React применил изменения в DOM, но до того, как браузер покажет кадр.

    useLayoutEffect(() => {
        conversationIdRef.current = conversationId;
        historyVersionRef.current += 1; // отличать старые запросы от актуальных
        initialLoadingRef.current = true;
        receivedDuringLoadRef.current = []; // события предыдущего чата больше не нужны
        deletedMessageIdsRef.current.clear();
        editedMessagesRef.current.clear();
        historyCursorsRef.current = { olderCursor: null, newerCursor: null };
        deferredMessagesRef.current.clear();
        latestWindowRequestedRef.current = false;
    }, [conversationId]);

    useLayoutEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const {
        messagesContainerRef,
        scrollToBottomAfterUpdate,
        scrollToMessageAfterUpdate,
        isNearBottom,
        isNearTop,
        resetScrollPosition,
        saveScrollBeforeUpdate,
        clearPrependScrollSnapshot,
    } = useMessageScrollPosition(messages);

    // Все ответы и события учитывают уже известные правки и удаления текущего чата.
    const applyKnownChanges = useCallback(
        (current: ClientMessage[]) =>
            applyKnownMessageChanges(current, editedMessagesRef.current, deletedMessageIdsRef.current),
        [],
    );

    // обрабатывает событие socket
    // получает message который мы возвращаем в publishMessageCreated() (через emit)
    const handleMessageCreated = useCallback(
        (message: Message) => {
            // Если авторизации нет(работа с сообщ. отключена) или событие пришло в другой чат — игнорируем.
            if (!enabled || message.conversationId !== conversationIdRef.current) return;
            if (deletedMessageIdsRef.current.has(message.id)) return; // чтобы запоздавший socket не вернул удалённое сообщение
            // если история еще загружается - временно сохраняем событие
            if (initialLoadingRef.current) {
                receivedDuringLoadRef.current.push(message);
                return;
            }

            // Проверяем, заменяет ли пришедшее сообщение уже отображаемое.
            const isReplacingLoadedMessage = messagesRef.current.some(
                (listedMessage) =>
                    listedMessage.id === message.id ||
                    Boolean(
                        message.clientMessageId &&
                        listedMessage.clientMessageId === message.clientMessageId &&
                        listedMessage.senderId === message.senderId,
                    ),
            );
            // newerCursor сущ. => ещё есть история. Наше сообщ. ничего не заменяет. Поэтому откладываем его
            // т.е. сохраняем в Map, но пока не отображаем
            if (historyCursorsRef.current.newerCursor && !isReplacingLoadedMessage) {
                deferredMessagesRef.current.set(message.id, message);
                return;
            }
            // Внизу показываем новое сообщение; при чтении старых не уводим пользователя со своего места.
            if (!historyCursorsRef.current.newerCursor && isNearBottom()) {
                scrollToBottomAfterUpdate();
            }

            // добавл. серверное сообщение без дублей, убираем известные удаления и очищает цитаты
            setMessages((current) => applyKnownChanges(mergeMessage(current, message)));
        },
        [enabled, isNearBottom, scrollToBottomAfterUpdate, applyKnownChanges],
    );

    const handleMessageUpdated = useCallback(
        (message: Message) => {
            if (!enabled || message.conversationId !== conversationIdRef.current) return;
            if (deletedMessageIdsRef.current.has(message.id)) return; // не удалено ли
            //  Если уже редачили, то более свежая правка не должна быть перезаписана более старой (может задержаться запрос например)
            const previous = editedMessagesRef.current.get(message.id);
            if (previous && Date.parse(previous.updatedAt) > Date.parse(message.updatedAt)) return;

            // Сохраняем правку и во время initial GET/pagination, чтобы их поздний ответ не затёр её.
            editedMessagesRef.current.set(message.id, message);
            setMessages((current) => applyKnownChanges(current)); // применяем правки и удаления к текущим сообщениям
        },
        [enabled, applyKnownChanges],
    );

    // добавл. id в REF, убираем удалённые сообщения и очищает цитаты на них
    const handleMessageDeleted = useCallback(
        ({ id, conversationId }: MessageDeletedEvent) => {
            if (!enabled || conversationId !== conversationIdRef.current) return;
            deletedMessageIdsRef.current.add(id);
            editedMessagesRef.current.delete(id);
            deferredMessagesRef.current.delete(id);
            // Событие и ответ своего DELETE используют один путь; повторное удаление безопасно.
            setMessages((current) => applyKnownChanges(current));
        },
        [enabled, applyKnownChanges],
    );

    // Socket вызывает только этот обработчик; state, REST и pagination остаются в message hook.
    const requestHistorySync = useCallback(() => {
        const currentConversationId = conversationIdRef.current;
        if (!currentConversationId) return;
        // запускает effect ниже
        setHistorySyncRequest({
            conversationId: currentConversationId,
            historyVersion: historyVersionRef.current,
        });
    }, []);

    // ------- ПЕРВОЕ ОТКРЫТИЕ: ОКНО НЕПРОЧИТАННЫХ ИЛИ КОНЕЦ ЧАТА -------
    useEffect(() => {
        paginationControllerRef.current?.abort();
        paginationControllerRef.current = null;
        resetScrollPosition();

        if (!conversationId || !enabled) {
            return;
        }

        const controller = new AbortController();

        const loadMessages = async () => {
            // При смене чата история и pagination начинаются с чистого состояния.
            setHistoryConversationId(conversationId);
            setMessages([]);
            setMessagesError(null);
            setHistorySyncError(null);
            historyCursorsRef.current = { olderCursor: null, newerCursor: null };
            setFirstUnreadMessageId(null);
            setLoadingDirection(null);
            setPaginationError(null);
            setMessagesLoading(true);

            try {
                const result = await getMessages(conversationId, authenticatedRequest, {
                    mode: "unread", // backend дальше сам решает в зависимости от есть ли unread messages
                    signal: controller.signal,
                });

                if (!controller.signal.aborted && conversationIdRef.current === conversationId) {
                    // При наличии непрочитанного начинаем возле него, иначе показываем конец чата.
                    if (result.firstUnreadMessageId) {
                        scrollToMessageAfterUpdate(result.firstUnreadMessageId);
                    } else {
                        scrollToBottomAfterUpdate();
                    }
                    historyCursorsRef.current = {
                        olderCursor: result.olderCursor,
                        newerCursor: result.newerCursor,
                    };
                    setFirstUnreadMessageId(result.firstUnreadMessageId);
                    const loadedIds = new Set(result.messages.map((message) => message.id));
                    const receivedInWindow = receivedDuringLoadRef.current.filter((message) => {
                        // если после загруж. окна есть ещё сообщ. и пришедшее сообщ-е нет в полученной странице GET
                        if (result.newerCursor && !loadedIds.has(message.id)) {
                            // добавляем в отложенные сообщения
                            deferredMessagesRef.current.set(message.id, message);
                            return false;
                        }
                        return true;
                    });
                    // Объединяем историю из GET с сообщениями, пришедшими через socket.io, пока мы ждали ответ
                    const merged = receivedInWindow.reduce<ClientMessage[]>(
                        (current, message) => mergeMessage(current, message),
                        result.messages,
                    );
                    // учитываем удаления и записываем результат
                    setMessages(applyKnownChanges(merged));
                }
            } catch (requestError) {
                if (!controller.signal.aborted && conversationIdRef.current === conversationId) {
                    setMessagesError(
                        requestError instanceof Error ? requestError.message : "Failed to load messages",
                    );
                }
            } finally {
                if (!controller.signal.aborted && conversationIdRef.current === conversationId) {
                    initialLoadingRef.current = false;
                    receivedDuringLoadRef.current = [];
                    setMessagesLoading(false);
                }
            }
        };

        void loadMessages();

        return () => {
            controller.abort();
            paginationControllerRef.current?.abort();
        };
    }, [
        authenticatedRequest,
        conversationId,
        enabled,
        resetScrollPosition,
        scrollToBottomAfterUpdate,
        scrollToMessageAfterUpdate,
        applyKnownChanges,
    ]);

    // обновляет историю открытого чата по данным БД: добавляет пропущенные сообщения, подставляет актуальный текст и убирает удалённые записи.
    //  Он вызывает reloadMessageHistory, объединяет результат с текущим state, сохраняя локальные отправки и свежие socket-события, и обновляет cursor pagination.
    // При этом сохраняет позицию скролла, не применяет результат к другому чату и при ошибке оставляет текущую историю с возможностью Retry.
    useEffect(() => {
        if (
            !enabled ||
            !historySyncRequest ||
            messagesLoading ||
            initialLoadingRef.current ||
            historySyncRequest.conversationId !== conversationId ||
            historySyncRequest.historyVersion !== historyVersionRef.current
        ) {
            return;
        }

        const controller = new AbortController();
        historySyncControllerRef.current = controller;
        // Старая страница не должна дописаться поверх перечитанной истории.
        paginationControllerRef.current?.abort();
        paginationControllerRef.current = null;
        setLoadingDirection(null);
        setHistorySyncError(null);

        //  сообщения которые были на сервере до reload (исключ. sending/failed)
        const serverMessagesBeforeReload = messagesRef.current.filter((message) => !message.localStatus);
        const serverIdsBeforeReload = new Set(serverMessagesBeforeReload.map((message) => message.id));
        // После Send из старой истории нужен конец чата; при обычном reconnect сохраняем открытое окно.
        const opensLatest = latestWindowRequestedRef.current;
        const oldestLoadedAt = opensLatest ? undefined : serverMessagesBeforeReload[0]?.createdAt;
        const newestLoadedPosition = opensLatest ? null : historyCursorsRef.current.newerCursor;
        const isCurrent = () =>
            !controller.signal.aborted && // не отменён эффект
            conversationIdRef.current === historySyncRequest.conversationId && // нужный чат
            historyVersionRef.current === historySyncRequest.historyVersion; // нужная версия истории

        // получаем свежую историю
        const syncHistory = async () => {
            try {
                // Перечитываем историю сообщений с БД
                const result = await reloadMessageHistory(
                    historySyncRequest.conversationId,
                    authenticatedRequest,
                    oldestLoadedAt, // грузит до самой старой даты которая уже была в UI
                    controller.signal,
                    newestLoadedPosition,
                );
                if (!isCurrent()) return;

                // ------- Получили историю -> обнаруживаем пропущенные удаления -------

                // Не грузим последние => значит грузим старые(значит reconnect), можем проверить удаленные
                // Заведомо избегаем ситуации когда с переходом к новому окну у нас старые сообщ. занесутся в удаленные
                if (!opensLatest) {
                    const reloadedIds = new Set(result.messages.map((message) => message.id));
                    // Если загруженный id отсутствует во всём перечитанном участке — сообщение удалили пока мы были offline.
                    for (const id of serverIdsBeforeReload) {
                        if (!reloadedIds.has(id)) {
                            deletedMessageIdsRef.current.add(id);
                            editedMessagesRef.current.delete(id);
                        }
                    }
                }

                // Внизу остаёмся внизу. При чтении истории сохраняем видимое сообщение перед заменой DOM.
                if (opensLatest || (!newestLoadedPosition && isNearBottom())) {
                    scrollToBottomAfterUpdate();
                } else {
                    saveScrollBeforeUpdate();
                }

                const deferredMessages = result.newerCursor ? [] : [...deferredMessagesRef.current.values()];
                if (!result.newerCursor) deferredMessagesRef.current.clear();
                setMessages((messagesNow) =>
                    // применяем edit, delete, если есть
                    applyKnownChanges(
                        // собрали новую историю сообщ., сохранили локальные отправки и reloaded сообщения, убрали дубли и отсортировали по времени
                        reconcileMessageHistory(
                            messagesNow,
                            [...result.messages, ...deferredMessages],
                            serverIdsBeforeReload,
                        ),
                    ),
                );

                historyCursorsRef.current = {
                    olderCursor: result.olderCursor,
                    newerCursor: result.newerCursor,
                };
                latestWindowRequestedRef.current = false;
                if (opensLatest) setFirstUnreadMessageId(null);
                setMessagesError(null);
                setPaginationError(null);
            } catch (requestError) {
                // При неудачной сверке не очищаем историю и локальные сообщения; пользователь может нажать Retry.
                if (isCurrent()) {
                    setHistorySyncError(
                        requestError instanceof Error ? requestError.message : "Failed to sync messages",
                    );
                }
            } finally {
                if (historySyncControllerRef.current === controller) historySyncControllerRef.current = null;
            }
        };
        void syncHistory();

        return () => {
            controller.abort();
            if (historySyncControllerRef.current === controller) historySyncControllerRef.current = null;
        };
    }, [
        historySyncRequest,
        messagesLoading,
        conversationId,
        enabled,
        authenticatedRequest,
        applyKnownChanges,
        isNearBottom,
        scrollToBottomAfterUpdate,
        saveScrollBeforeUpdate,
    ]);

    // ------- ПРОДОЛЖЕНИЕ ИСТОРИИ В ОБЕ СТОРОНЫ -------
    // Получает направление: старее, новее или последнее окно после собственной отправки.
    // Загружает одну страницу, объединяет сообщения и обновляет только затронутую границу.
    // Сохраняет видимое сообщение; устаревший ответ другого чата не применяет.
    const loadHistoryPage = useCallback(
        async (direction: HistoryPageDirection) => {
            const currentConversationId = conversationIdRef.current;
            if (
                !enabled ||
                !currentConversationId ||
                initialLoadingRef.current ||
                historyConversationId !== currentConversationId
            )
                return;

            let cursor: MessageHistoryCursor | null = null;
            if (direction === "older") cursor = historyCursorsRef.current.olderCursor;
            if (direction === "newer") cursor = historyCursorsRef.current.newerCursor;
            // запружаем вверх или вниз, но соотв. курсора нет - продолжать в эту сторону нечего
            if (direction !== "latest" && !cursor) return;
            // Защита от параллельной загрузки, при загрузке другой стр. или reconnect-сверке - ждём завершения
            if (
                direction !== "latest" &&
                (paginationControllerRef.current || historySyncControllerRef.current)
            )
                return;

            // если переход к концу уже запрошен и его страница ещё загружается - не запускаем повторный GET
            if (direction === "latest" && latestWindowRequestedRef.current && paginationControllerRef.current)
                return;

            // Подготавливаем переход к концу
            if (direction === "latest") {
                latestWindowRequestedRef.current = true; // намерение открыть конец чата
                paginationControllerRef.current?.abort(); // отменяем выполняющуюся страницу старого участка
                historySyncControllerRef.current?.abort(); // отменяем сверку старую
                historySyncControllerRef.current = null;
            }
            const controller = new AbortController();
            paginationControllerRef.current = controller;
            const historyVersion = historyVersionRef.current;
            const serverIdsBeforeRequest = new Set(
                // берём актуальные сообщения, исключ. локальные sending/failed, берём ID
                messagesRef.current.filter((message) => !message.localStatus).map((message) => message.id),
            );

            // проверка актуальности ответа
            // true, если запрос не отменили, открыт тот же чат, версия истории осталась прежней
            const isCurrent = () =>
                !controller.signal.aborted &&
                conversationIdRef.current === currentConversationId &&
                historyVersionRef.current === historyVersion;
            setLoadingDirection(direction);
            setPaginationError(null);

            try {
                const result = await getMessages(currentConversationId, authenticatedRequest, {
                    cursor: cursor?.id,
                    cursorCreatedAt: cursor?.createdAt,
                    direction: direction === "latest" ? undefined : direction,
                    signal: controller.signal,
                });
                // проверяем, чтобы запрос не устарел за время ожидания
                if (!isCurrent()) return;

                // За время запроса пользователь мог прокрутить дальше или отправить сообщение.
                // Поэтому снимаем текущую геометрию только сейчас, перед изменением messages.
                if (direction === "latest") scrollToBottomAfterUpdate();
                else saveScrollBeforeUpdate();

                // дошли ли до конца
                const reachedLatest = direction !== "older" && !result.newerCursor;
                // если дошли до конца, копируем накопленные отложенные сообщения из Map в массив
                const deferredMessages = reachedLatest ? [...deferredMessagesRef.current.values()] : [];
                if (reachedLatest) deferredMessagesRef.current.clear();
                // обновл. messages
                setMessages((currentMessages) => {
                    // Собранный список сообщений для отображения, пока без добавления отложенных
                    const merged =
                        direction === "latest"
                            ? // заменяем старое окно
                              reconcileMessageHistory(
                                  currentMessages,
                                  result.messages,
                                  serverIdsBeforeRequest,
                              )
                            : // при older/newer дополняем существующий список
                              // допустим currentMessages содержит №71-100, а result.messages содержит №101 и №102
                              // берём #101, вызываем mergeMessage(currentMessages, #101); mergeMessage(массив71–101, сообщение102)
                              result.messages.reduce<ClientMessage[]>(mergeMessage, currentMessages);
                    // reduce подмешивает deferred messages в merged. Применяем все изменения
                    return applyKnownChanges(deferredMessages.reduce<ClientMessage[]>(mergeMessage, merged));
                });

                // --- Обновление курсоров ---
                if (direction !== "newer") historyCursorsRef.current.olderCursor = result.olderCursor;
                if (direction !== "older") historyCursorsRef.current.newerCursor = result.newerCursor;
                if (direction === "latest") {
                    latestWindowRequestedRef.current = false;
                    setFirstUnreadMessageId(null);
                }
            } catch (requestError) {
                if (isCurrent()) {
                    setPaginationError({
                        direction,
                        message:
                            requestError instanceof Error ? requestError.message : "Failed to load messages",
                    });
                    // убирает сохраненный снимок скролла, чтобы он не применился к след. обновлению
                    clearPrependScrollSnapshot();
                }
            } finally {
                // Старый запрос не должен сбрасывать loading нового запроса.
                if (paginationControllerRef.current === controller) {
                    paginationControllerRef.current = null;
                    setLoadingDirection(null);
                }
            }
        },
        [
            enabled,
            historyConversationId,
            authenticatedRequest,
            applyKnownChanges,
            scrollToBottomAfterUpdate,
            saveScrollBeforeUpdate,
            clearPrependScrollSnapshot,
        ],
    );

    // Получает scroll-событие контейнера сообщений из ChatPanel.
    // У нужного края запрашивает страницу, если соответствующий cursor ещё существует.
    // Ничего не запускает повторно при активном запросе или ошибке до Retry.
    const handleMessagesScroll = () => {
        if (paginationError) return;
        if (isNearBottom() && historyCursorsRef.current.newerCursor) void loadHistoryPage("newer");
        else if (isNearTop()) void loadHistoryPage("older");
    };

    // Получает текущее направление неудачной загрузки из state.
    // Повторяет тот же запрос после нажатия Retry.
    // При успехе убирает ошибку и дополняет историю обычным путём.
    const retryHistoryPage = () => {
        if (paginationError) void loadHistoryPage(paginationError.direction);
    };

    // Автоматическая дозагрузка сообщений вниз, но даже если user не скроллил
    // Новые сообщ. появились на экране? Тогда effect чекает мы всё ещё близко к низу? Если да - загружает ещё
    // Например экран вмещает 50 сообщ, а получили только 30, handleMessagesScroll без скролла не вызовется, тут и работает эффект
    useEffect(() => {
        if (
            !messagesLoading &&
            !loadingDirection &&
            !paginationError &&
            isNearBottom() &&
            historyCursorsRef.current.newerCursor
        )
            void loadHistoryPage("newer");
    }, [messages, messagesLoading, loadingDirection, paginationError, isNearBottom, loadHistoryPage]);

    // выполняет POST и заменяет temp-сообщение на серверное, либо помечает его как failed.
    const deliverMessage = async (pending: ClientMessage) => {
        if (sendingIdsRef.current.has(pending.id)) return; // проверка повторной отправки, если пользователь быстро нажал кнопку несколько раз.
        sendingIdsRef.current.add(pending.id);

        const historyVersion = historyVersionRef.current;
        // Проверяем и поколение чата: уйти и вернуться в тот же id тоже считается сменой истории.
        const isCurrent = () =>
            conversationIdRef.current === pending.conversationId &&
            historyVersionRef.current === historyVersion;
        try {
            const message = await sendMessageRequest(
                pending.conversationId,
                pending.content,
                authenticatedRequest,
                pending.replyToId ?? undefined,
                pending.clientMessageId ?? undefined, // тот же UUID при первой отправке и при Retry
            );
            // Проверяем можно ли обновл. текущий чат
            if (isCurrent()) {
                // меняем state
                // По id убираем серверный дубль, по clientMessageId заменяем свой temp.
                setMessages((current) =>
                    current.some((item) => item.id === pending.id)
                        ? applyKnownChanges(mergeMessage(current, message))
                        : current,
                ); // socket уже заменил temp; поздний POST не вернёт сообщение после локального Delete
            }
        } catch (error) {
            if (isCurrent()) {
                // меняем state
                setMessages((current) =>
                    current.map((item) =>
                        item.id === pending.id // нашли наше временное сообщение
                            ? {
                                  ...item,
                                  localStatus: "failed",
                                  sendError:
                                      error instanceof Error ? error.message : "Failed to send message",
                              }
                            : item,
                    ),
                );
            }
        } finally {
            sendingIdsRef.current.delete(pending.id);
        }
    };

    const sendMessage = (content: string, replyTo?: Message) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !enabled || !currentUser) {
            throw new Error("No conversation selected");
        }

        const now = new Date().toISOString();
        const clientMessageId = crypto.randomUUID(); // создаём один раз; Retry копирует его вместе с pending
        // Создали объект сообщения с временным id, чтобы сразу показать его в списке.
        const pending: ClientMessage = {
            id: `temp:${clientMessageId}`, // локальный id для UI, не серверный Message.id
            clientMessageId,
            content,
            createdAt: now,
            updatedAt: now,
            senderId: currentUser.id,
            sender: currentUser,
            conversationId: currentConversationId,
            replyToId: replyTo?.id ?? null,
            replyTo: replyTo
                ? {
                      id: replyTo.id,
                      content: replyTo.content,
                      updatedAt: replyTo.updatedAt,
                      sender: replyTo.sender,
                  }
                : null,
            localStatus: "sending",
        };
        scrollToBottomAfterUpdate(); // просим существующий useLayoutEffect прокрутить вниз после отрисовки.
        setMessages((current) => [...current, pending]); // добавляем сообщ. в конец списка, чтобы сразу показать его в UI.
        // Если читали середину переписки, собственная отправка открывает последнее окно без пробела в истории.
        if (historyCursorsRef.current.newerCursor) void loadHistoryPage("latest");
        // Ошибки POST остаются в bubble, а composer можно сразу использовать снова.
        void deliverMessage(pending); // асинхронно отправляем на сервер, не дожидаясь ответа.
    };

    const retryMessage = (messageId: string) => {
        const pending = messages.find((message) => message.id === messageId);
        if (!pending || pending.localStatus !== "failed" || sendingIdsRef.current.has(messageId)) return;
        const now = new Date().toISOString();
        const retried: ClientMessage = {
            ...pending,
            createdAt: now,
            updatedAt: now,
            localStatus: "sending",
            sendError: undefined,
        };
        // Retry — новая попытка сейчас: переносим тот же temp вниз и сразу обновляем время.
        scrollToBottomAfterUpdate();
        setMessages((current) => [...current.filter((message) => message.id !== messageId), retried]);
        if (historyCursorsRef.current.newerCursor) void loadHistoryPage("latest");
        void deliverMessage(retried);
    };

    const editMessage = async (messageId: string, content: string) => {
        const currentConversationId = conversationIdRef.current;
        const historyVersion = historyVersionRef.current;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        const message = await editMessageRequest(messageId, content, authenticatedRequest);

        // PATCH старого чата не должен менять сообщения в уже открытом новом чате.
        if (
            conversationIdRef.current === currentConversationId &&
            historyVersionRef.current === historyVersion
        ) {
            // Ответ PATCH и socket-событие используют один обработчик, независимо от порядка доставки.
            handleMessageUpdated(message);
        }
    };

    const deleteMessage = async (messageId: string) => {
        const currentConversationId = conversationIdRef.current;

        // Failed bubble существует только локально: temp id не отправляем в DELETE API.
        if (messages.some((message) => message.id === messageId && message.localStatus === "failed")) {
            if (sendingIdsRef.current.has(messageId)) return;
            setMessages((current) => current.filter((message) => message.id !== messageId));
            return;
        }

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        await deleteMessageRequest(messageId, authenticatedRequest);

        // DELETE старого чата не должен менять сообщения в уже открытом новом чате.
        if (conversationIdRef.current === currentConversationId) {
            handleMessageDeleted({ id: messageId, conversationId: currentConversationId });
        }
    };

    // Если сменился чат, то временно возвр. пустой массив (в return условие)
    const isCurrentHistory = Boolean(conversationId && enabled) && historyConversationId === conversationId;

    return {
        messages: isCurrentHistory ? messages : [],
        messagesLoading: Boolean(conversationId && enabled) && (!isCurrentHistory || messagesLoading),
        messagesError: isCurrentHistory ? messagesError : null,
        historySyncError: isCurrentHistory ? historySyncError : null,
        requestHistorySync,
        firstUnreadMessageId: isCurrentHistory ? firstUnreadMessageId : null,
        isLoadingOlder: isCurrentHistory && loadingDirection === "older",
        isLoadingNewer: isCurrentHistory && (loadingDirection === "newer" || loadingDirection === "latest"),
        olderMessagesError:
            isCurrentHistory && paginationError?.direction === "older" ? paginationError.message : null,
        newerMessagesError:
            isCurrentHistory && paginationError && paginationError.direction !== "older"
                ? paginationError.message
                : null,
        retryHistoryPage,
        messagesContainerRef,
        handleMessagesScroll,
        sendMessage,
        handleMessageCreated,
        handleMessageUpdated,
        handleMessageDeleted,
        retryMessage,
        editMessage,
        deleteMessage,
    };
};
