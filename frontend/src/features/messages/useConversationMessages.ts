import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import {
    deleteMessage as deleteMessageRequest,
    editMessage as editMessageRequest,
    getMessages,
    sendMessage as sendMessageRequest,
    type Message,
} from "./messages.api";

type UseConversationMessagesOptions = {
    conversationId: string | null;
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
};

export const useConversationMessages = ({
    conversationId,
    enabled,
    authenticatedRequest,
}: UseConversationMessagesOptions) => {
    // Показывает, какому чату принадлежат сообщ-я, находящиеся сейчас в messages.
    // Чтобы не показывать с другого чата при смене его
    const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);

    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);

    const conversationIdRef = useRef(conversationId); // актуальный ID
    const messagesContainerRef = useRef<HTMLDivElement | null>(null); // DOM-эл списка сообщений
    const loadOlderControllerRef = useRef<AbortController | null>(null); // хранит контроллер для отмены запроса
    const isLoadingOlderRef = useRef(false); // хранит состояние загрузки старых сообщений, чтобы не гонять несколько запросов одновременно
    // Одноразовый флаг для прокрутки вниз после initial load, не после pagination.
    const shouldScrollToBottomRef = useRef(false);
    // Снимок прямо перед prepend: сохраняем видимое сообщение и его положение на экране.
    const prependScrollRef = useRef<{
        anchor: HTMLElement | null;
        offset: number;
        scrollHeight: number;
        scrollTop: number;
    } | null>(null);

    // useLayoutEffect выполняется раньше обычного useEffect — сразу после того, как
    // React применил изменения в DOM, но до того, как браузер покажет кадр.
    useLayoutEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    // Первая страница сообщений
    useEffect(() => {
        loadOlderControllerRef.current?.abort();
        loadOlderControllerRef.current = null;
        isLoadingOlderRef.current = false;
        // Новый чат должен дождаться собственной первой страницы перед прокруткой вниз.
        shouldScrollToBottomRef.current = false;
        // Снимок старого чата больше не нужен.
        prependScrollRef.current = null;

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
                    shouldScrollToBottomRef.current = true;
                    setMessages(result.messages);
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
                    setMessagesLoading(false);
                }
            }
        };

        void loadMessages();

        return () => {
            controller.abort();
            loadOlderControllerRef.current?.abort();
        };
    }, [authenticatedRequest, conversationId, enabled]);

    // Выставляем нужную позицию до отрисовки кадра, чтобы скролл не прыгал.
    useLayoutEffect(() => {
        const container = messagesContainerRef.current;

        if (!container) {
            return;
        }

        // После initial load DOM уже знает полную высоту первой страницы.
        if (shouldScrollToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            // Следующие изменения messages не должны снова переносить пользователя вниз.
            shouldScrollToBottomRef.current = false;
            return;
        }

        const previousScroll = prependScrollRef.current;

        if (!previousScroll) {
            return;
        }

        if (previousScroll.anchor && container.contains(previousScroll.anchor)) {
            // Возвращаем то же сообщение на ту же высоту, даже если у bubbles разные размеры.
            const currentOffset =
                previousScroll.anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
            container.scrollTop += currentOffset - previousScroll.offset;
        } else {
            // Запасной вариант, если сообщение-якорь удалили вместе с другим обновлением.
            container.scrollTop =
                previousScroll.scrollTop + (container.scrollHeight - previousScroll.scrollHeight);
        }
        prependScrollRef.current = null;
    }, [messages]);

    // Вызываем из ChatPanel при скролле
    const handleMessagesScroll = () => {
        const container = messagesContainerRef.current;
        const currentConversationId = conversationIdRef.current;

        if (
            !container ||
            !currentConversationId ||
            historyConversationId !== currentConversationId ||
            !hasMore ||
            !nextCursor ||
            isLoadingOlderRef.current ||
            !enabled ||
            container.scrollTop > 80
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
                const result = await getMessages(currentConversationId, authenticatedRequest, {
                    cursor: nextCursor,
                    signal: controller.signal,
                });

                if (controller.signal.aborted || conversationIdRef.current !== currentConversationId) {
                    return;
                }

                // За время запроса пользователь мог прокрутить дальше или отправить сообщение.
                // Поэтому снимаем текущую геометрию только сейчас, перед изменением messages.
                const container = messagesContainerRef.current;
                if (container) {
                    const { top, bottom } = container.getBoundingClientRect();
                    const anchor =
                        Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).find(
                            (element) => {
                                const rect = element.getBoundingClientRect();
                                return rect.bottom > top && rect.top < bottom;
                            },
                        ) ?? null;
                    prependScrollRef.current = {
                        anchor,
                        offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
                        scrollHeight: container.scrollHeight,
                        scrollTop: container.scrollTop,
                    };
                }

                setMessages((currentMessages) => {
                    const currentIds = new Set(currentMessages.map((message) => message.id));
                    const olderMessages = result.messages.filter((message) => !currentIds.has(message.id));

                    return [...olderMessages, ...currentMessages];
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
                    prependScrollRef.current = null;
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

    const sendMessage = async (content: string, replyToId?: string) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        const message = await sendMessageRequest(
            currentConversationId,
            content,
            authenticatedRequest,
            replyToId,
        );

        // Ответ старого POST не добавляем, если пользователь уже сменил чат.
        if (conversationIdRef.current === currentConversationId) {
            setMessages((currentMessages) => [...currentMessages, message]);
        }
    };

    const editMessage = async (messageId: string, content: string) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        const message = await editMessageRequest(messageId, content, authenticatedRequest);

        // PATCH старого чата не должен менять сообщения в уже открытом новом чате.
        if (conversationIdRef.current === currentConversationId) {
            // Обновляем также цитаты этого сообщения, чтобы они совпадали с будущим GET.
            setMessages((currentMessages) =>
                currentMessages.map((currentMessage) => {
                    if (currentMessage.id === message.id) return message;
                    if (currentMessage.replyTo?.id === message.id) {
                        return {
                            ...currentMessage,
                            replyTo: { ...currentMessage.replyTo, content: message.content },
                        };
                    }
                    return currentMessage;
                }),
            );
        }
    };

    const deleteMessage = async (messageId: string) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        await deleteMessageRequest(messageId, authenticatedRequest);

        // DELETE старого чата не должен менять сообщения в уже открытом новом чате.
        if (conversationIdRef.current === currentConversationId) {
            setMessages((currentMessages) =>
                // Повторяем ON DELETE SET NULL в уже загруженных reply previews.
                currentMessages
                    .filter((currentMessage) => currentMessage.id !== messageId)
                    .map((message) =>
                        message.replyToId === messageId
                            ? { ...message, replyToId: null, replyTo: null }
                            : message,
                    ),
            );
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
        editMessage,
        deleteMessage,
    };
};
