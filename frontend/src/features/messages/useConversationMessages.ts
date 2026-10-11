import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { mergeMessage, removeDeletedMessages, updateEditedMessage } from "./message-state-updates";
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
} from "./messages.api";

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
    // Id сообщ., которые прямо сейчас отправляются
    const sendingIdsRef = useRef(new Set<string>());
    const historyVersionRef = useRef(0);
    const initialLoadingRef = useRef(true);
    const receivedDuringLoadRef = useRef<Message[]>([]); // события, пришедшие пока initial GET ещё ждёт ответа
    // Помним удаления в текущем чате, чтобы запоздавший GET/socket не вернул сообщение или его цитату.
    const deletedMessageIdsRef = useRef(new Set<string>());
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);

    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);

    const conversationIdRef = useRef(conversationId); // актуальный ID
    const loadOlderControllerRef = useRef<AbortController | null>(null); // хранит контроллер для отмены запроса
    const isLoadingOlderRef = useRef(false); // хранит состояние загрузки старых сообщений, чтобы не гонять несколько запросов одновременно

    // useLayoutEffect выполняется раньше обычного useEffect — сразу после того, как
    // React применил изменения в DOM, но до того, как браузер покажет кадр.

    useLayoutEffect(() => {
        conversationIdRef.current = conversationId;
        historyVersionRef.current += 1; // отличать старые запросы от актуальных
        initialLoadingRef.current = true;
        receivedDuringLoadRef.current = []; // события предыдущего чата больше не нужны
        deletedMessageIdsRef.current.clear();
    }, [conversationId]);

    const {
        messagesContainerRef,
        scrollToBottomAfterUpdate,
        isNearBottom,
        isNearTop,
        resetScrollPosition,
        saveScrollBeforePrepend,
        clearPrependScrollSnapshot,
    } = useMessageScrollPosition(messages);

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
            // Внизу показываем новое сообщение; при чтении старых не уводим пользователя со своего места.
            if (isNearBottom()) {
                scrollToBottomAfterUpdate();
            }

            // добавл. серверное сообщение без дублей, убираем известные удаления и очищает цитаты
            setMessages((current) =>
                removeDeletedMessages(mergeMessage(current, message), deletedMessageIdsRef.current),
            );
        },
        [enabled, isNearBottom, scrollToBottomAfterUpdate],
    );

    // добавл. id в REF, убираем удалённые сообщения и очищает цитаты на них
    const handleMessageDeleted = useCallback(
        ({ id, conversationId }: MessageDeletedEvent) => {
            if (!enabled || conversationId !== conversationIdRef.current) return;
            deletedMessageIdsRef.current.add(id);
            // Событие и ответ своего DELETE используют один путь; повторное удаление безопасно.
            setMessages((current) => removeDeletedMessages(current, deletedMessageIdsRef.current));
        },
        [enabled],
    );

    // Первая страница сообщений
    useEffect(() => {
        loadOlderControllerRef.current?.abort();
        loadOlderControllerRef.current = null;
        isLoadingOlderRef.current = false;
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
            setNextCursor(null);
            setHasMore(false);
            setIsLoadingOlder(false);
            setOlderMessagesError(null);
            setMessagesLoading(true);

            try {
                const result = await getMessages(conversationId, authenticatedRequest, {
                    signal: controller.signal,
                });

                if (!controller.signal.aborted && conversationIdRef.current === conversationId) {
                    // Первую страницу показываем с самых новых сообщений внизу.
                    scrollToBottomAfterUpdate();
                    // GET мог не увидеть новые события: добавляем их к истории, а не теряем при замене state.
                    const merged = receivedDuringLoadRef.current.reduce<ClientMessage[]>(
                        (current, message) => mergeMessage(current, message),
                        result.messages,
                    );
                    // учитываем удаления и записываем результат
                    setMessages(removeDeletedMessages(merged, deletedMessageIdsRef.current));
                    setNextCursor(result.nextCursor);
                    setHasMore(result.hasMore);
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
            loadOlderControllerRef.current?.abort();
        };
    }, [authenticatedRequest, conversationId, enabled, resetScrollPosition, scrollToBottomAfterUpdate]);

    // Вызываем из ChatPanel при скролле
    const handleMessagesScroll = () => {
        const currentConversationId = conversationIdRef.current;

        if (
            !isNearTop() ||
            !currentConversationId ||
            historyConversationId !== currentConversationId ||
            !hasMore ||
            !nextCursor ||
            isLoadingOlderRef.current ||
            !enabled
        ) {
            return;
        }

        const controller = new AbortController();
        loadOlderControllerRef.current = controller;
        isLoadingOlderRef.current = true;

        setIsLoadingOlder(true);
        setOlderMessagesError(null);

        const loadOlderMessages = async () => {
            try {
                // Если cursor удалили, продолжаем от самого старого живого серверного сообщения.
                const getCursor = () =>
                    deletedMessageIdsRef.current.has(nextCursor)
                        ? messages.find(
                              (message) =>
                                  !message.localStatus && !deletedMessageIdsRef.current.has(message.id),
                          )?.id
                        : nextCursor;
                const cursor = getCursor();
                let result = await getMessages(currentConversationId, authenticatedRequest, {
                    cursor,
                    signal: controller.signal,
                });

                // Cursor мог исчезнуть и во время запроса; один раз повторяем с актуальной границей.
                if (
                    cursor &&
                    deletedMessageIdsRef.current.has(cursor) &&
                    !controller.signal.aborted &&
                    conversationIdRef.current === currentConversationId
                ) {
                    result = await getMessages(currentConversationId, authenticatedRequest, {
                        cursor: getCursor(),
                        signal: controller.signal,
                    });
                }

                if (controller.signal.aborted || conversationIdRef.current !== currentConversationId) {
                    return;
                }

                // За время запроса пользователь мог прокрутить дальше или отправить сообщение.
                // Поэтому снимаем текущую геометрию только сейчас, перед изменением messages.
                saveScrollBeforePrepend();

                setMessages((currentMessages) => {
                    const currentIds = new Set(currentMessages.map((message) => message.id));
                    const olderMessages = result.messages.filter((message) => !currentIds.has(message.id));

                    return removeDeletedMessages(
                        [...olderMessages, ...currentMessages],
                        deletedMessageIdsRef.current,
                    );
                });
                setNextCursor(result.nextCursor);
                setHasMore(result.hasMore);
            } catch (requestError) {
                if (!controller.signal.aborted && conversationIdRef.current === currentConversationId) {
                    setOlderMessagesError(
                        requestError instanceof Error
                            ? requestError.message
                            : "Failed to load older messages",
                    );
                    clearPrependScrollSnapshot();
                }
            } finally {
                // Старый запрос не должен сбрасывать loading нового запроса.
                if (loadOlderControllerRef.current === controller) {
                    loadOlderControllerRef.current = null;
                    isLoadingOlderRef.current = false;
                    setIsLoadingOlder(false);
                }
            }
        };

        void loadOlderMessages();
    };

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
                        ? removeDeletedMessages(mergeMessage(current, message), deletedMessageIdsRef.current)
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
            replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, sender: replyTo.sender } : null,
            localStatus: "sending",
        };
        scrollToBottomAfterUpdate(); // просим существующий useLayoutEffect прокрутить вниз после отрисовки.
        setMessages((current) => [...current, pending]); // добавляем сообщ. в конец списка, чтобы сразу показать его в UI.
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
        void deliverMessage(retried);
    };

    const editMessage = async (messageId: string, content: string) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        const message = await editMessageRequest(messageId, content, authenticatedRequest);

        // PATCH старого чата не должен менять сообщения в уже открытом новом чате.
        if (conversationIdRef.current === currentConversationId) {
            setMessages((currentMessages) => updateEditedMessage(currentMessages, message));
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
        isLoadingOlder: isCurrentHistory && isLoadingOlder,
        olderMessagesError: isCurrentHistory ? olderMessagesError : null,
        messagesContainerRef,
        handleMessagesScroll,
        sendMessage,
        handleMessageCreated,
        handleMessageDeleted,
        retryMessage,
        editMessage,
        deleteMessage,
    };
};
