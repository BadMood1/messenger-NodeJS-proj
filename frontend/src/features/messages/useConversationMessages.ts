import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { getMessages, sendMessage as sendMessageRequest, type Message } from "./messages.api";

type UseConversationMessagesOptions = {
    conversationId: string | null;
    accessToken: string | null;
};

export const useConversationMessages = ({
    conversationId,
    accessToken,
}: UseConversationMessagesOptions) => {
    const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);

    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const [isLoadingOlder, setIsLoadingOlder] = useState(false);
    const [olderMessagesError, setOlderMessagesError] = useState<string | null>(null);

    const conversationIdRef = useRef(conversationId);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const loadOlderControllerRef = useRef<AbortController | null>(null);
    const isLoadingOlderRef = useRef(false);
    const prependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

    // Async-ответы всегда сверяются с id, актуальным на последнем рендере.
    useLayoutEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    useEffect(() => {
        loadOlderControllerRef.current?.abort();
        loadOlderControllerRef.current = null;
        isLoadingOlderRef.current = false;
        prependScrollRef.current = null;

        if (!conversationId || !accessToken) {
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
                const result = await getMessages(conversationId, accessToken, {
                    signal: controller.signal,
                });

                if (!controller.signal.aborted && conversationIdRef.current === conversationId) {
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
    }, [accessToken, conversationId]);

    // После prepend восстанавливаем прежнюю видимую область до отрисовки кадра.
    useLayoutEffect(() => {
        const previousScroll = prependScrollRef.current;
        const container = messagesContainerRef.current;

        if (!previousScroll || !container) {
            return;
        }

        container.scrollTop =
            previousScroll.scrollTop + (container.scrollHeight - previousScroll.scrollHeight);
        prependScrollRef.current = null;
    }, [messages]);

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
            !accessToken ||
            container.scrollTop > 80
        ) {
            return;
        }

        const controller = new AbortController();
        loadOlderControllerRef.current = controller;
        isLoadingOlderRef.current = true;

        // Сохраняем геометрию до prepend, чтобы затем восстановить позицию скролла.
        prependScrollRef.current = {
            scrollHeight: container.scrollHeight,
            scrollTop: container.scrollTop,
        };
        setIsLoadingOlder(true);
        setOlderMessagesError(null);

        const loadOlderMessages = async () => {
            try {
                const result = await getMessages(currentConversationId, accessToken, {
                    cursor: nextCursor,
                    signal: controller.signal,
                });

                if (
                    controller.signal.aborted ||
                    conversationIdRef.current !== currentConversationId
                ) {
                    return;
                }

                setMessages((currentMessages) => {
                    const currentIds = new Set(currentMessages.map((message) => message.id));
                    const olderMessages = result.messages.filter(
                        (message) => !currentIds.has(message.id),
                    );

                    return [...olderMessages, ...currentMessages];
                });
                setNextCursor(result.nextCursor);
                setHasMore(result.hasMore);
            } catch (requestError) {
                if (
                    !controller.signal.aborted &&
                    conversationIdRef.current === currentConversationId
                ) {
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

    const sendMessage = async (content: string) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !accessToken) {
            throw new Error("No conversation selected");
        }

        const message = await sendMessageRequest(currentConversationId, content, accessToken);

        // Ответ старого POST не добавляем, если пользователь уже сменил чат.
        if (conversationIdRef.current === currentConversationId) {
            setMessages((currentMessages) => [...currentMessages, message]);
        }
    };

    const isCurrentHistory =
        Boolean(conversationId && accessToken) && historyConversationId === conversationId;

    return {
        messages: isCurrentHistory ? messages : [],
        messagesLoading:
            Boolean(conversationId && accessToken) && (!isCurrentHistory || messagesLoading),
        messagesError: isCurrentHistory ? messagesError : null,
        isLoadingOlder: isCurrentHistory && isLoadingOlder,
        olderMessagesError: isCurrentHistory ? olderMessagesError : null,
        messagesContainerRef,
        handleMessagesScroll,
        sendMessage,
    };
};
