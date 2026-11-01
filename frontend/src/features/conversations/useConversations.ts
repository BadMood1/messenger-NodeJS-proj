import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { requestWithRetry, type RequestRetryState } from "../../lib/request-retry";
import type { ClientMessage, Message, MessageDeletedEvent } from "../messages/messages.api";
import type { VisibleMessagePosition } from "../messages/useLastVisibleMessage";
import {
    applyConversationMessageEvent,
    isMessageNewerThanLastMessage,
    type ConversationMessageEvent,
} from "./conversation-state-updates";
import {
    getConversations,
    type Conversation,
    type ConversationReadResult,
    type ConversationReadState,
} from "./conversations.api";
import { applyConversationReadResult } from "./conversation-read-state";
import { applyPeerReadReceipt } from "./conversation-read-receipts";
import {
    applyLocalConversationRead,
    getDisplayedUnreadCount,
    preserveLocalConversationRead,
    updateLocalReadFromMessage,
} from "./local-conversation-read";

type ConversationListEvent =
    | ConversationMessageEvent
    | { type: "read"; result: ConversationReadResult }
    | { type: "receipt"; readState: ConversationReadState };

type UseConversationsOptions = {
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
};

// Получает признак авторизации и функцию защищённых запросов.
// Загружает диалоги со счётчиками и обновляет их preview по событиям сообщений.
// Возвращает список, состояния загрузки и обработчики realtime.
export const useConversations = ({ enabled, authenticatedRequest }: UseConversationsOptions) => {
    // ------- СОСТОЯНИЯ И REFS -------
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState<string | null>(null);
    const [refreshError, setRefreshError] = useState<string | null>(null); // ошибка при повторной загрузке, когда список уже есть
    const [reloadVersion, setReloadVersion] = useState(0); // state счетчик GET'ов
    const [requestRetry, setRequestRetry] = useState<RequestRetryState | null>(null);
    const retryStateRef = useRef<RequestRetryState | null>(null);
    // блокируем автоматич. запуск новых серий загрузок
    const isAutomaticReloadBlockedRef = useRef(false);
    const conversationsRef = useRef<Conversation[]>([]); // актуальный список для обработчиков событий
    const controllerRef = useRef<AbortController | null>(null); // контроллер текущего GET
    const hasLoadedRef = useRef(false); // Была ли хотя бы одна успешная загрузка
    const reloadQueuedRef = useRef(false); // Нужно ли выполнить еще один GET после текущего
    const eventsDuringLoadRef = useRef<ConversationListEvent[]>([]); // события полученные во время GET
    const deletedMessageIdsRef = useRef(new Set<string>()); // id сообщений, которые были удалены ( уже знаем )

    // ------- ОБНОВЛЕНИЕ СПИСКА -------
    // Получает новый список диалогов.
    // Сохраняет его для обработчиков событий и для React одновременно.
    // Обновляет sidebar через state.
    const updateConversationList = useCallback((nextConversations: Conversation[]) => {
        conversationsRef.current = nextConversations;
        setConversations(nextConversations);
    }, []);

    // ------- ЗАПРОС ПОВТОРНОЙ ЗАГРУЗКИ -------
    // Получает запрос на повторную загрузку списка диалогов.
    // Запускает GET, а если GET уже идёт — ставит одну загрузку в очередь.
    // Обновляет список через effect(ниже) без параллельных запросов.
    const requestConversationsReload = useCallback(() => {
        if (!enabled || isAutomaticReloadBlockedRef.current) return;
        if (controllerRef.current) {
            // Ручной Retry/reconnect ускоряет уже ожидающий повтор вместо второго GET.
            if (retryStateRef.current) {
                retryStateRef.current.retryNow();
                return;
            }
            reloadQueuedRef.current = true;
            return;
        }
        setReloadVersion((version) => version + 1);
    }, [enabled]);

    // Получает ручной Retry или сигнал восстановления соединения.
    // Разрешает новую серию после окончательной ошибки; события сообщений сами лимит не сбрасывают.
    // Запускает загрузку через тот же вход, который защищает от параллельных GET.
    const retryConversations = useCallback(() => {
        isAutomaticReloadBlockedRef.current = false;
        requestConversationsReload();
    }, [requestConversationsReload]);

    // ------- РЕЗУЛЬТАТ СОХРАНЕНИЯ ПРОЧТЕНИЯ -------
    // Получает одинаковые данные из ответа PATCH либо события conversation:read.
    // Сразу обновляет границу и счётчик, а при текущем GET сохраняет результат для повторного применения.
    // Обычное прочтение не загружает список заново; GET нужен только при неоднозначном снимке.
    const handleConversationRead = useCallback(
        (readResult: ConversationReadResult) => {
            if (!enabled) return;
            if (controllerRef.current) eventsDuringLoadRef.current.push({ type: "read", result: readResult });
            const applied = applyConversationReadResult(
                conversationsRef.current,
                readResult,
                deletedMessageIdsRef.current,
            );
            updateConversationList(applied.conversations);
            if (applied.needsReload) requestConversationsReload();
        },
        [enabled, updateConversationList, requestConversationsReload],
    );

    // ------- ЛОКАЛЬНО УВИДЕННОЕ И ПОДТВЕРЖДЕНИЕ СОБЕСЕДНИКА -------
    // Получает видимую позицию, историю и признак загрузки её последней страницы.
    // Сразу сохраняет локальный прогресс в активной вкладке, не меняя подтверждённую границу.
    // Обновляет только UI; PATCH и его повторы остаются в useConversationRead.
    const handleLocalConversationRead = useCallback(
        (
            position: VisibleMessagePosition | null,
            messages: ClientMessage[],
            isLatestHistoryLoaded: boolean,
        ) => {
            if (!enabled || !position || document.hidden || !document.hasFocus()) return;

            updateConversationList(
                applyLocalConversationRead(
                    conversationsRef.current,
                    position,
                    messages,
                    isLatestHistoryLoaded,
                ),
            );
        },
        [enabled, updateConversationList],
    );

    // Получает socket-подтверждение прочтения собеседника.
    // Обновляет его границу и запоминает событие, если сейчас идёт GET.
    // Меняет галочки; собственное локальное прочтение сюда не передаётся.
    const handleConversationReadReceipt = useCallback(
        (readState: ConversationReadState) => {
            if (!enabled) return;
            if (controllerRef.current) eventsDuringLoadRef.current.push({ type: "receipt", readState });
            updateConversationList(applyPeerReadReceipt(conversationsRef.current, readState));
            if (
                !conversationsRef.current.some((conversation) => conversation.id === readState.conversationId)
            )
                requestConversationsReload();
        },
        [enabled, updateConversationList, requestConversationsReload],
    );

    // ------- Обработчики ниже передаются в useRealtimeConnection -------

    // Получает серверное сообщение и тип события: создание или правка.
    // Одновременно обновляет preview и счётчик; неизвестные и неоднозначные события сверяет через REST.
    // Сохраняет новый текст, количество непрочитанных и порядок списка диалогов.
    const handleConversationMessage = useCallback(
        (message: Message, eventType: "created" | "updated") => {
            if (!enabled || deletedMessageIdsRef.current.has(message.id)) return;
            // есть ли conversation в списке
            const conversation = conversationsRef.current.find(
                (conversation) => conversation.id === message.conversationId,
            );
            // оборачиваем сообщение во внутренний объект
            const event: ConversationMessageEvent = { type: eventType, message };

            if (controllerRef.current) eventsDuringLoadRef.current.push(event);

            // меняем превью диалога, если он есть, и применяем изменения к списку диалогов
            const withLocalRead = updateLocalReadFromMessage(conversationsRef.current, event);
            updateConversationList(
                applyConversationMessageEvent(withLocalRead, event, deletedMessageIdsRef.current),
            );
            // Если диалога не было — загружаем его через REST.
            // Если preview удалён, по оставшемуся счётчику нельзя определить, учтено ли событие.
            if (!conversation || (!conversation.lastMessage && conversation.unreadCount > 0)) {
                requestConversationsReload();
                return;
            }
            // Если сообщение из Create находится перед текущим preview, сверяем число с сервером:
            // это может быть как запоздавшее новое сообщение, так и повтор уже учтённого.
            if (
                eventType === "created" &&
                message.id !== conversation.lastMessage?.id &&
                !isMessageNewerThanLastMessage(message, conversation.lastMessage)
            ) {
                requestConversationsReload();
            }
            // Если сообщение из Edit находится после текущего preview, его Create мог быть пропущен.
            if (eventType === "updated" && isMessageNewerThanLastMessage(message, conversation.lastMessage)) {
                requestConversationsReload();
            }
        },
        [enabled, updateConversationList, requestConversationsReload],
    );

    // ------- ОБРАБОТКА УДАЛЕНИЯ -------
    // Получает результат удаления с новым preview.
    // Сразу заменяет удалённый preview и запрашивает актуальный счётчик через REST.
    // Обновляет только список диалогов, не историю открытого чата.
    const handleConversationMessageDeleted = useCallback(
        (message: MessageDeletedEvent) => {
            if (!enabled || deletedMessageIdsRef.current.has(message.id)) return;
            deletedMessageIdsRef.current.add(message.id);
            const event: ConversationMessageEvent = { type: "deleted", message };
            if (controllerRef.current) eventsDuringLoadRef.current.push(event);
            // Заменяем preview и его дату одним обновлением списка, без временного lastMessage: null.
            const withLocalRead = updateLocalReadFromMessage(conversationsRef.current, event);
            updateConversationList(
                applyConversationMessageEvent(withLocalRead, event, deletedMessageIdsRef.current),
            );
            // Удаление даже старого сообщения может уменьшить unreadCount.
            // Preview уже заменён из DELETE/socket; GET нужен для точного unreadCount.
            requestConversationsReload();
        },
        [enabled, updateConversationList, requestConversationsReload],
    );

    // ------- ЗАГРУЗКА СПИСКА ЧЕРЕЗ REST -------
    // Первая загрузка списка диалогов и повторная загрузка по кнопке Retry.
    // Также обновляет список после connect/reconnect и событий, которым понадобился GET.
    useEffect(() => {
        if (!enabled) {
            return;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        eventsDuringLoadRef.current = [];
        retryStateRef.current = null;

        // Получает диалоги через существующий GET /conversations.
        // Добавляет к ответу события, пришедшие во время запроса.
        // Сохраняет актуальный список или ошибку загрузки.
        const loadConversations = async () => {
            let succeeded = false;
            setLoading(!hasLoadedRef.current);
            setRequestRetry(null);
            setError(null);
            setRefreshError(null);

            try {
                const result = await requestWithRetry(
                    () => getConversations(authenticatedRequest, { signal: controller.signal }),
                    {
                        signal: controller.signal,
                        onRetryState: (state) => {
                            if (controller.signal.aborted) return;
                            retryStateRef.current = state; // для обработчиков reload/reconnect
                            setRequestRetry(state); // обновл. интерфейс (показываем countdown и Retry now)
                        },
                    },
                );

                // Для всех событий во время GET применяем их к ответу
                if (!controller.signal.aborted) {
                    // GET мог начаться до socket-события: применяем события к ответу, а не теряем их.
                    let updatedConversations = result;
                    for (const event of eventsDuringLoadRef.current) {
                        if (event.type === "receipt") {
                            updatedConversations = applyPeerReadReceipt(
                                updatedConversations,
                                event.readState,
                            );
                            continue;
                        }
                        // Если PATCH/socket уже подтвердил прочтение, старый GET не должен его откатить.
                        if (event.type === "read") {
                            const applied = applyConversationReadResult(
                                updatedConversations,
                                event.result,
                                deletedMessageIdsRef.current,
                            );
                            updatedConversations = applied.conversations;
                            if (applied.needsReload) reloadQueuedRef.current = true;
                            continue;
                        }
                        // Если в очереди есть Create/Edit и Delete одного сообщения,
                        // пропускаем Create/Edit, потому что сообщение уже помечено как удалённое.
                        if (event.type !== "deleted" && deletedMessageIdsRef.current.has(event.message.id))
                            continue;
                        updatedConversations = applyConversationMessageEvent(
                            updatedConversations,
                            event,
                            deletedMessageIdsRef.current,
                        );
                    }
                    // GET может закончиться раньше PATCH: увиденное локально остаётся в UI прочитанным.
                    const hadDeletionDuringLoad = eventsDuringLoadRef.current.some(
                        (event) => event.type === "deleted",
                    );
                    updateConversationList(
                        preserveLocalConversationRead(
                            updatedConversations,
                            conversationsRef.current,
                            hadDeletionDuringLoad,
                        ),
                    );
                    hasLoadedRef.current = true;
                    isAutomaticReloadBlockedRef.current = false; // автоматическое обновл. разрешено
                    succeeded = true;
                }
            } catch (requestError) {
                // Отмена ожидаема при смене токена или уходе со страницы.
                if (!controller.signal.aborted) {
                    isAutomaticReloadBlockedRef.current = true;
                    const message =
                        requestError instanceof Error ? requestError.message : "Failed to load conversations";
                    // Первая загрузка показывает error state; фоновая сохраняет список и предлагает Retry.
                    if (hasLoadedRef.current) setRefreshError(message);
                    else setError(message);
                }
            } finally {
                if (controllerRef.current === controller) {
                    controllerRef.current = null;
                    retryStateRef.current = null;
                    eventsDuringLoadRef.current = [];
                    if (!controller.signal.aborted) {
                        setLoading(false);
                        // если попросили ещё одну загрузку (requestConversationsReload это делает)
                        if (reloadQueuedRef.current) {
                            reloadQueuedRef.current = false;
                            // Исчерпание повторов не запускает новую серию из старой очереди.
                            if (succeeded) setReloadVersion((version) => version + 1);
                        }
                    }
                }
            }
        };

        void loadConversations();

        return () => {
            controller.abort(); // Cleanup отменяет запрос при смене токена или уходе со страницы.
            if (controllerRef.current === controller) {
                controllerRef.current = null;
                eventsDuringLoadRef.current = [];
                reloadQueuedRef.current = false;
            }
        };
    }, [authenticatedRequest, enabled, reloadVersion, updateConversationList]);

    // ------- ДАННЫЕ ДЛЯ СТРАНИЦЫ -------
    // В refs и readState остаются серверные значения; наружу отдаём число с локальным прогрессом.
    const displayedConversations = useMemo(
        () =>
            conversations.map((conversation) => {
                const unreadCount = getDisplayedUnreadCount(conversation);
                return unreadCount === conversation.unreadCount
                    ? conversation
                    : { ...conversation, unreadCount };
            }),
        [conversations],
    );
    // После выхода не показываем данные, оставшиеся в памяти от прошлого токена.
    return {
        conversations: enabled ? displayedConversations : [],
        loading: enabled && loading,
        error: enabled ? error : null,
        refreshError: enabled ? refreshError : null,
        requestRetry: enabled ? requestRetry : null,
        retryConversations,
        handleConversationRead,
        handleLocalConversationRead,
        handleConversationReadReceipt,
        handleConversationMessage,
        handleConversationMessageDeleted,
    };
};
