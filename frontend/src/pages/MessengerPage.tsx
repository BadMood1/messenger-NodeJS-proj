import { useEffect, useState } from "react";

import { ChatPanel } from "../components/messenger/ChatPanel";
import { ConversationSidebar } from "../components/messenger/ConversationSidebar";
import { NavRail } from "../components/messenger/NavRail";
import { useAuth } from "../features/auth/useAuth";
import { getConversations, type Conversation } from "../features/conversations/conversations.api";
import { getMessages, type Message } from "../features/messages/messages.api";

export const MessengerPage = () => {
    const { user, accessToken } = useAuth();
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(Boolean(accessToken));
    const [error, setError] = useState<string | null>(null);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);

    const selectedConversation =
        conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

    // Когда AuthProvider выдаёт accessToken, загружаем доступные пользователю диалоги.
    // Если токен позже изменится, useEffect выполнится ещё раз.
    useEffect(() => {
        // Без токена защищённый endpoint вернёт 401, поэтому запрос пока не делаем.
        if (!accessToken) {
            return;
        }

        // Cleanup меняет флаг, чтобы завершившийся старый запрос
        // не обновил state после ухода со страницы или смены токена.
        let cancelled = false;

        // загружаем диалоги
        const loadConversations = async () => {
            setLoading(true);
            setError(null);

            try {
                const result = await getConversations(accessToken);

                if (!cancelled) {
                    setConversations(result);
                }
            } catch (requestError) {
                if (!cancelled) {
                    setError(
                        requestError instanceof Error ? requestError.message : "Failed to load conversations",
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        // Сам callback useEffect нельзя делать async, поэтому вызываем
        // отдельную async-функцию и явно игнорируем возвращаемый Promise.
        void loadConversations();

        // React вызывает cleanup перед повторным эффектом и при размонтировании.
        return () => {
            cancelled = true;
        };
    }, [accessToken]);

    // Новый AbortController отменяет запрос прошлого чата при быстром переключении.
    useEffect(() => {
        if (!selectedConversationId || !accessToken) {
            return;
        }

        const controller = new AbortController();

        const loadMessages = async () => {
            setMessagesLoading(true);
            setMessagesError(null);

            try {
                const result = await getMessages(selectedConversationId, accessToken, controller.signal);

                if (!controller.signal.aborted) {
                    setMessages(result);
                }
            } catch (requestError) {
                // AbortError ожидаем при смене чата — это не ошибка для пользователя.
                if (!controller.signal.aborted) {
                    setMessagesError(
                        requestError instanceof Error ? requestError.message : "Failed to load messages",
                    );
                }
            } finally {
                if (!controller.signal.aborted) {
                    setMessagesLoading(false);
                }
            }
        };

        void loadMessages();

        return () => {
            controller.abort();
        };
    }, [accessToken, selectedConversationId]);

    const handleSelectConversation = (conversationId: string) => {
        if (conversationId === selectedConversationId) {
            return;
        }

        setSelectedConversationId(conversationId);
        setMessages([]);
        setMessagesError(null);
        setMessagesLoading(true);
    };

    // ESC закрывает выбранный чат и возвращает ChatPanel в empty state.
    useEffect(() => {
        const closeConversationOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSelectedConversationId(null);
                setMessages([]);
                setMessagesError(null);
                setMessagesLoading(false);
            }
        };

        window.addEventListener("keydown", closeConversationOnEscape);

        // Убираем обработчик при уходе со страницы, чтобы он не остался в памяти.
        return () => {
            window.removeEventListener("keydown", closeConversationOnEscape);
        };
    }, []);

    return (
        <main className="flux-messenger-shell">
            <div className="flux-messenger-ambient" aria-hidden="true" />

            {/* ==================== NAVIGATION ==================== */}
            <NavRail username={user?.username} />

            {/* ==================== CONVERSATIONS ==================== */}
            <ConversationSidebar
                conversations={conversations}
                loading={loading}
                error={error}
                selectedConversationId={selectedConversationId}
                onSelectConversation={handleSelectConversation}
            />

            {/* ==================== CHAT ==================== */}
            <ChatPanel
                conversation={selectedConversation}
                messages={messages}
                messagesLoading={messagesLoading}
                messagesError={messagesError}
                currentUserId={user?.id ?? null}
            />
        </main>
    );
};
