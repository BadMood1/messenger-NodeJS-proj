import { useCallback, useEffect, useState } from "react";

import type { AuthenticatedRequest } from "../../auth/authenticated-request";
import { requestWithRetry } from "../../../lib/request-retry";
import { mergeMessage, reconcileMessageHistory } from "../state/message-state-updates";
import { compareMessagesByCreatedAt } from "../state/message-ordering";
import { getMessages } from "../messages.api";
import type { ClientMessage, Message, MessageDeletedEvent } from "../messages.types";
import type { useConversationMessageState } from "../state/useConversationMessageState";
import type { useMessageScrollPosition } from "../scroll/useMessageScrollPosition";
import { reloadMessageHistory } from "./reload-message-history";
import { useMessageHistoryWindow } from "./useMessageHistoryWindow";
import { useMessageHistoryPagination } from "./useMessageHistoryPagination";

type UseMessageHistoryOptions = {
    conversationId: string | null;
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
    messageState: ReturnType<typeof useConversationMessageState>;
    scroll: ReturnType<typeof useMessageScrollPosition>;
};

// Получает выбранный чат, общий state сообщений и обработчики scroll.
// Управляет initial load, pagination, reconnect и буферизацией новых socket-сообщений.
// Возвращает историю с состояниями загрузки и командами перехода; все GET используют общие курсоры и контроллеры.
export const useMessageHistory = ({
    conversationId,
    enabled,
    authenticatedRequest,
    messageState,
    scroll,
}: UseMessageHistoryOptions) => {
    const {
        messages, setMessages, messagesRef, conversationIdRef, historyVersionRef,
        applyKnownChanges, rememberMissingMessagesAsDeleted, isMessageDeleted,
    } = messageState;
    const historyWindow = useMessageHistoryWindow(conversationId);
    const {
        historyConversationId, setHistoryConversationId,
        initialLoadingRef, hasLoadedHistoryRef,
        initialRetry, setInitialRetry, initialRetryRef,
        historySyncRetry, setHistorySyncRetry, historySyncRetryRef,
        receivedDuringLoadRef, historySyncControllerRef, paginationControllerRef,
        historyCursors, setHistoryCursors, historyCursorsRef, deferredMessagesRef, latestWindowRequestedRef,
        firstUnreadMessageId, setFirstUnreadMessageId,
    } = historyWindow;
    const [initialLoadVersion, setInitialLoadVersion] = useState(0);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);
    const [historySyncError, setHistorySyncError] = useState<string | null>(null);
    const [historySyncRequest, setHistorySyncRequest] = useState<{
        conversationId: string;
        historyVersion: number;
    } | null>(null);

    const {
        loadingDirection, setLoadingDirection,
        paginationError, setPaginationError,
        paginationRetry, setPaginationRetry,
        scrollToLatestMessages, handleMessagesScroll, retryHistoryPage, requestLatestWindowForSend,
    } = useMessageHistoryPagination({
        enabled,
        authenticatedRequest,
        messageState,
        historyWindow,
        scroll,
        messagesLoading,
    });

    const {
        messagesContainerRef, isScrolledAwayFromBottom, scrollToBottomAfterUpdate,
        scrollToMessageAfterUpdate, isNearBottom, resetScrollPosition, saveScrollBeforeUpdate,
    } = scroll;

    // обрабатывает событие socket
    // получает message который мы возвращаем в publishMessageCreated() (через emit)
    const handleMessageCreated = useCallback(
        (message: Message) => {
            // Если авторизации нет(работа с сообщ. отключена) или событие пришло в другой чат — игнорируем.
            if (!enabled || message.conversationId !== conversationIdRef.current) return;
            if (isMessageDeleted(message.id)) return; // чтобы запоздавший socket не вернул удалённое сообщение
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
        [
            enabled, isNearBottom, scrollToBottomAfterUpdate, applyKnownChanges, isMessageDeleted,
            conversationIdRef, messagesRef, deferredMessagesRef, historyCursorsRef,
            initialLoadingRef, receivedDuringLoadRef, setMessages,
        ],
    );

    // Получает ручной Retry первой загрузки.
    // Перезапускает initial effect с mode: unread и новой ограниченной серией попыток.
    // Сохраняет открытие возле непрочитанных вместо подмены первой загрузки сверкой latest.
    const retryInitialMessages = useCallback(() => setInitialLoadVersion((version) => version + 1), []);

    // Socket вызывает только этот обработчик; state, REST и pagination остаются в message hook.
    const requestHistorySync = useCallback(() => {
        const currentConversationId = conversationIdRef.current;
        if (!currentConversationId) return;
        // Reconnect продолжает ожидающий запрос; параллельную серию не создаём.
        const waitingRetry = initialRetryRef.current ?? historySyncRetryRef.current;
        if (waitingRetry) {
            waitingRetry.retryNow();
            return;
        }
        if (!hasLoadedHistoryRef.current && !initialLoadingRef.current) {
            retryInitialMessages();
            return;
        }
        // запускает effect ниже
        setHistorySyncRequest({
            conversationId: currentConversationId,
            historyVersion: historyVersionRef.current,
        });
    }, [
        retryInitialMessages, conversationIdRef, historyVersionRef,
        hasLoadedHistoryRef, historySyncRetryRef, initialLoadingRef, initialRetryRef,
    ]);

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
            setHistoryCursors({ olderCursor: null, newerCursor: null });
            setFirstUnreadMessageId(null);
            setLoadingDirection(null);
            setPaginationError(null);
            setMessagesLoading(true);
            setInitialRetry(null);
            setHistorySyncRetry(null);
            setPaginationRetry(null);
            initialLoadingRef.current = true;
            hasLoadedHistoryRef.current = false;
            initialRetryRef.current = null;
            historySyncRetryRef.current = null;

            try {
                const result = await requestWithRetry(
                    () =>
                        getMessages(conversationId, authenticatedRequest, {
                            mode: "unread", // Каждый повтор сохраняет режим первого открытия.
                            signal: controller.signal,
                        }),
                    {
                        signal: controller.signal,
                        onRetryState: (state) => {
                            if (controller.signal.aborted) return;
                            initialRetryRef.current = state;
                            setInitialRetry(state);
                        },
                    },
                );

                if (!controller.signal.aborted && conversationIdRef.current === conversationId) {
                    // При наличии непрочитанного начинаем возле него, иначе показываем конец чата.
                    if (result.firstUnreadMessageId) {
                        scrollToMessageAfterUpdate(result.firstUnreadMessageId);
                    } else {
                        scrollToBottomAfterUpdate();
                    }
                    setHistoryCursors({
                        olderCursor: result.olderCursor,
                        newerCursor: result.newerCursor,
                    });
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
                    hasLoadedHistoryRef.current = true;
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
        initialLoadVersion,
        enabled,
        resetScrollPosition,
        scrollToBottomAfterUpdate,
        scrollToMessageAfterUpdate,
        applyKnownChanges,
        conversationIdRef,
        setMessages,
        deferredMessagesRef, hasLoadedHistoryRef, historyCursorsRef,
        historySyncRetryRef, initialLoadingRef, initialRetryRef, paginationControllerRef,
        receivedDuringLoadRef, setFirstUnreadMessageId, setHistoryConversationId,
        setHistorySyncRetry, setInitialRetry, setLoadingDirection, setPaginationError,
        setPaginationRetry, setHistoryCursors,
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
            !hasLoadedHistoryRef.current ||
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
        setHistorySyncRetry(null);
        setPaginationRetry(null);
        historySyncRetryRef.current = null;

        //  сообщения которые были на сервере до reload (исключ. sending/failed)
        // Для границы reconnect используем серверный порядок: локальные bubbles могут стоять иначе.
        const serverMessagesBeforeReload = messagesRef.current
            .filter((message) => !message.localStatus)
            .sort(compareMessagesByCreatedAt);
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
                const result = await requestWithRetry(
                    () =>
                        reloadMessageHistory(
                            historySyncRequest.conversationId,
                            authenticatedRequest,
                            oldestLoadedAt, // грузит до самой старой даты которая уже была в UI
                            controller.signal,
                            newestLoadedPosition,
                        ),
                    {
                        signal: controller.signal,
                        onRetryState: (state) => {
                            if (controller.signal.aborted) return;
                            historySyncRetryRef.current = state;
                            setHistorySyncRetry(state);
                        },
                    },
                );
                if (!isCurrent()) return;

                // ------- Получили историю -> обнаруживаем пропущенные удаления -------

                // Не грузим последние => значит грузим старые(значит reconnect), можем проверить удаленные
                // Заведомо избегаем ситуации когда с переходом к новому окну у нас старые сообщ. занесутся в удаленные
                if (!opensLatest) {
                    rememberMissingMessagesAsDeleted(serverIdsBeforeReload, result.messages);
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
                        // собрали новую историю сообщ., сохранили локальные отправки и их порядок, убрали дубли
                        reconcileMessageHistory(
                            messagesNow,
                            [...result.messages, ...deferredMessages],
                            serverIdsBeforeReload,
                        ),
                    ),
                );

                setHistoryCursors({
                    olderCursor: result.olderCursor,
                    newerCursor: result.newerCursor,
                });
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
            if (historySyncControllerRef.current === controller) {
                historySyncControllerRef.current = null;
                historySyncRetryRef.current = null;
                setHistorySyncRetry(null);
            }
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
        conversationIdRef,
        historyVersionRef,
        messagesRef,
        setMessages,
        rememberMissingMessagesAsDeleted,
        deferredMessagesRef, hasLoadedHistoryRef, historyCursorsRef,
        historySyncControllerRef, historySyncRetryRef, initialLoadingRef,
        latestWindowRequestedRef, paginationControllerRef, setFirstUnreadMessageId,
        setHistorySyncRetry, setLoadingDirection, setPaginationError, setPaginationRetry,
        setHistoryCursors,
    ]);

    // Получает событие удаления сообщения.
    // Если оно относится к открытому чату, убирает сообщение из буфера отложенных событий.
    // Массив сообщений и известные удаления обновляет общий message state.
    const forgetDeferredMessage = useCallback(
        ({ id, conversationId }: Pick<MessageDeletedEvent, "id" | "conversationId">) => {
            if (!enabled || conversationId !== conversationIdRef.current) return;
            deferredMessagesRef.current.delete(id);
        },
        [enabled, conversationIdRef, deferredMessagesRef],
    );

    // Если сменился чат, то временно возвр. пустой массив (в return условие)
    const isCurrentHistory = Boolean(conversationId && enabled) && historyConversationId === conversationId;

    return {
        messages: isCurrentHistory ? messages : [],
        // Если у текущего чата есть olderCursor, значит, выше загруженных сообщений ещё существует история
        hasOlderMessages: isCurrentHistory && Boolean(historyCursors.olderCursor),
        isLatestHistoryLoaded: isCurrentHistory && !messagesLoading && !historyCursors.newerCursor,
        isScrollToLatestButtonVisible:
            isCurrentHistory &&
            !messagesLoading &&
            !messagesError &&
            (isScrolledAwayFromBottom || Boolean(historyCursors.newerCursor)),
        isLoadingLatest: isCurrentHistory && loadingDirection === "latest",
        scrollToLatestMessages,
        messagesLoading: Boolean(conversationId && enabled) && (!isCurrentHistory || messagesLoading),
        messagesError: isCurrentHistory ? messagesError : null,
        initialRetry: isCurrentHistory ? initialRetry : null,
        historySyncRetry: isCurrentHistory ? historySyncRetry : null,
        paginationRetry: isCurrentHistory ? paginationRetry : null,
        retryInitialMessages,
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
        handleMessageCreated,
        forgetDeferredMessage,
        requestLatestWindowForSend,
    };
};
