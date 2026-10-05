import { useEffect, useRef, useState } from "react";

import { ChatPanel } from "../components/messenger/ChatPanel";
import { ConversationSidebar } from "../components/messenger/ConversationSidebar";
import { NavRail } from "../components/messenger/NavRail";
import { useAuth } from "../features/auth/useAuth";
import { useConversations } from "../features/conversations/useConversations";
import { useConversationMessages } from "../features/messages/useConversationMessages";

export const MessengerPage = () => {
    const { user, accessToken, authenticatedRequest } = useAuth();
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const shellRef = useRef<HTMLElement | null>(null); // ссылка на элемент main
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
        retryMessage,
        editMessage,
        deleteMessage,
    } = useConversationMessages({
        conversationId: selectedConversationId,
        enabled: isAuthenticated,
        authenticatedRequest,
        currentUser: user,
    });

    const handleSelectConversation = (conversationId: string) => {
        if (conversationId !== selectedConversationId) {
            setSelectedConversationId(conversationId);
        }
    };

    // Для правильной высоты на мобилке, когда откр. экранная клавиатура
    useEffect(() => {
        const viewport = window.visualViewport; // видимая пользователю обл. экрана
        if (!viewport) return;
        // На mobile клавиатура уменьшает видимую область, даже когда dvh не меняется.
        const updateHeight = () => {
            // защита от зума
            if (viewport.scale === 1)
                shellRef.current?.style.setProperty("--flux-mobile-height", `${viewport.height}px`);
            // --flux-mobile-height: 500px;
        };
        updateHeight();
        viewport.addEventListener("resize", updateHeight);
        return () => viewport.removeEventListener("resize", updateHeight);
    }, []);

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
        // data-chat-open даёт css понять открыт ли чат, потом в css в зависимости от значения применяем display(none/flex)
        <main ref={shellRef} className="flux-messenger-shell" data-chat-open={Boolean(selectedConversation)}>
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
                onRetryMessage={retryMessage}
                onEditMessage={editMessage}
                onDeleteMessage={deleteMessage}
                messagesContainerRef={messagesContainerRef}
                onMessagesScroll={handleMessagesScroll}
                isLoadingOlder={isLoadingOlder}
                olderMessagesError={olderMessagesError}
                onBack={() => setSelectedConversationId(null)}
            />
        </main>
    );
};
