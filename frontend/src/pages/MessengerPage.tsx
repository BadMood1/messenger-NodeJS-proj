import { useEffect, useState } from "react";

import { ChatPanel } from "../components/messenger/ChatPanel";
import { ConversationSidebar } from "../components/messenger/ConversationSidebar";
import { NavRail } from "../components/messenger/NavRail";
import { useAuth } from "../features/auth/useAuth";
import { useConversations } from "../features/conversations/useConversations";
import { useConversationMessages } from "../features/messages/useConversationMessages";

export const MessengerPage = () => {
    const { user, accessToken, authenticatedRequest } = useAuth();
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const isAuthenticated = Boolean(accessToken);

    // Берём данные о диалогах из нашего хука
    const { conversations, loading, error } = useConversations({
        enabled: isAuthenticated,
        authenticatedRequest,
    });
    // Находим полный объект по выбранному id
    const selectedConversation =
        conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

    // Данные сообщений из хука
    const {
        messages,
        messagesLoading,
        messagesError,
        isLoadingOlder,
        olderMessagesError,
        messagesContainerRef,
        handleMessagesScroll,
        sendMessage,
        editMessage,
        deleteMessage,
    } = useConversationMessages({
        conversationId: selectedConversationId,
        enabled: isAuthenticated,
        authenticatedRequest,
    });

    const handleSelectConversation = (conversationId: string) => {
        if (conversationId !== selectedConversationId) {
            setSelectedConversationId(conversationId);
        }
    };

    // ESC закрывает выбранный чат; message hook сам очистит его историю.
    useEffect(() => {
        const closeConversationOnEscape = (event: KeyboardEvent) => {
            // Если Escape обработал другой UI-эл. или внутри menu|dialog'а, то чат не закрываем
            if (
                event.defaultPrevented ||
                event
                    .composedPath()
                    // смотрим цепочку событий и проверяем есть ли среди них элементы с:
                    .some(
                        (target) =>
                            target instanceof Element &&
                            target.matches('[role="menu"], [role="alertdialog"]'),
                    )
            )
                return;

            if (event.key === "Escape") {
                setSelectedConversationId(null);
            }
        };

        window.addEventListener("keydown", closeConversationOnEscape);

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
                key={selectedConversation?.id ?? "no-conversation"}
                conversation={selectedConversation}
                messages={messages}
                messagesLoading={messagesLoading}
                messagesError={messagesError}
                currentUserId={user?.id ?? null}
                onSendMessage={sendMessage}
                onEditMessage={editMessage}
                onDeleteMessage={deleteMessage}
                messagesContainerRef={messagesContainerRef}
                onMessagesScroll={handleMessagesScroll}
                isLoadingOlder={isLoadingOlder}
                olderMessagesError={olderMessagesError}
            />
        </main>
    );
};
