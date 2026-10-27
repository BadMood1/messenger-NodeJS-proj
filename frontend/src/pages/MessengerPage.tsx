import { useCallback, useEffect, useRef, useState } from "react";

import { ChatPanel } from "../components/messenger/ChatPanel";
import { ConversationSidebar } from "../components/messenger/ConversationSidebar";
import { NavRail } from "../components/messenger/NavRail";
import { useAuth } from "../features/auth/useAuth";
import { useConversations } from "../features/conversations/useConversations";
import { useConversationMessages } from "../features/messages/useConversationMessages";
import type { Message, MessageDeletedEvent } from "../features/messages/messages.api";
import { useRealtimeConnection } from "../features/realtime/useRealtimeConnection";

export const MessengerPage = () => {
    // ------- AUTH И СОСТОЯНИЕ СТРАНИЦЫ -------
    const { user, accessToken, authenticatedRequest, getAccessToken, resolveAccessTokenAfter401 } = useAuth();
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const shellRef = useRef<HTMLElement | null>(null); // ссылка на элемент main
    const isAuthenticated = Boolean(accessToken);

    // ------- СПИСОК ДИАЛОГОВ -------
    // Берём данные о диалогах из нашего хука
    const {
        conversations,
        loading,
        error,
        refreshError,
        requestConversationsReload,
        handleConversationMessage,
        handleConversationMessageDeleted,
    } = useConversations({
        enabled: isAuthenticated,
        authenticatedRequest,
    });
    // Находим полный объект по выбранному id
    const selectedConversation =
        conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

    // ------- ИСТОРИЯ ОТКРЫТОГО ЧАТА -------
    // Данные сообщений из хука
    const {
        messages,
        messagesLoading,
        messagesError,
        historySyncError,
        requestHistorySync,
        isLoadingOlder,
        isLoadingNewer,
        olderMessagesError,
        newerMessagesError,
        firstUnreadMessageId,
        retryHistoryPage,
        messagesContainerRef,
        handleMessagesScroll,
        sendMessage,
        retryMessage,
        handleMessageCreated, // соед. два хука (с realtime)
        handleMessageUpdated,
        handleMessageDeleted,
        editMessage,
        deleteMessage,
    } = useConversationMessages({
        conversationId: selectedConversationId,
        enabled: isAuthenticated,
        authenticatedRequest,
        currentUser: user,
    });

    // ------- SOCKET-СОБЫТИЯ СООБЩЕНИЙ -------
    // Получает новое сообщение из socket.
    // Передаёт его в историю открытого чата и в список диалогов.
    // Обновляет оба участка UI одним событием.
    const onMessageCreated = useCallback(
        (message: Message) => {
            handleMessageCreated(message); // обновл. историю
            handleConversationMessage(message); // обновл. sidebar
        },
        [handleMessageCreated, handleConversationMessage],
    );

    // Получает изменённое сообщение из socket.
    // Передаёт правку в историю и в preview диалога.
    // Обновляет текст, не меняя дату отправки сообщения.
    const onMessageUpdated = useCallback(
        (message: Message) => {
            handleMessageUpdated(message);
            handleConversationMessage(message);
        },
        [handleMessageUpdated, handleConversationMessage],
    );

    // Получает id удалённого сообщения и его чата из socket.
    // Передаёт удаление в историю и в обработчик списка диалогов.
    // Убирает сообщение из чата и обновляет последний текст sidebar.
    const onMessageDeleted = useCallback(
        (message: MessageDeletedEvent) => {
            handleMessageDeleted(message);
            handleConversationMessageDeleted(message);
        },
        [handleMessageDeleted, handleConversationMessageDeleted],
    );

    // ------- СИНХРОНИЗАЦИЯ ПОСЛЕ CONNECT / RECONNECT -------
    // Получает сигнал об успешном подключении socket.
    // Запрашивает актуальную историю открытого чата и список диалогов.
    // Обновляет сообщения и sidebar после первого connect или reconnect.
    const onConnected = useCallback(() => {
        requestHistorySync(); // сверка истории открытого чата
        requestConversationsReload(); // обновление списка диалогов
    }, [requestHistorySync, requestConversationsReload]);

    // ------- ПОДКЛЮЧЕНИЕ SOCKET -------
    // дальше эти данные передадим в ChatPannel
    const { isPeerTyping, notifyTyping, stopTyping, presenceByUserId, isPeerOnline, peerLastSeenAt } = useRealtimeConnection({
        enabled: isAuthenticated,
        conversations,
        conversationId: selectedConversationId,
        conversationUserId: selectedConversation?.user?.id ?? null,
        getAccessToken,
        resolveAccessTokenAfter401,
        onMessageCreated, // socket получает событие, message hook обновляет messages
        onMessageUpdated,
        onMessageDeleted,
        onConnected,
    });

    // ------- ВЫБОР ДИАЛОГА -------
    const handleSelectConversation = (conversationId: string) => {
        if (conversationId !== selectedConversationId) {
            setSelectedConversationId(conversationId);
        }
    };

    // ------- ВЫСОТА MOBILE VIEWPORT -------
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

    // ------- ЗАКРЫТИЕ ЧАТА ПО ESC -------
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

    // ------- РЕНДЕР СТРАНИЦЫ -------
    return (
        // data-chat-open даёт css понять открыт ли чат, потом в css в зависимости от значения применяем display(none/flex)
        <main ref={shellRef} className="flux-messenger-shell" data-chat-open={Boolean(selectedConversation)}>
            <div className="flux-messenger-ambient" aria-hidden="true" />

            {/* ==================== NAVIGATION ==================== */}
            <NavRail username={user?.username} />

            {/* ==================== CONVERSATIONS ==================== */}
            <ConversationSidebar
                conversations={conversations}
                presenceByUserId={presenceByUserId}
                loading={loading}
                error={error}
                refreshError={refreshError}
                onRetryConversations={requestConversationsReload}
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
                historySyncError={historySyncError}
                onRetryHistorySync={requestHistorySync}
                currentUserId={user?.id ?? null}
                onSendMessage={sendMessage}
                onRetryMessage={retryMessage}
                onEditMessage={editMessage}
                onDeleteMessage={deleteMessage}
                messagesContainerRef={messagesContainerRef}
                onMessagesScroll={handleMessagesScroll}
                isLoadingOlder={isLoadingOlder}
                isLoadingNewer={isLoadingNewer}
                olderMessagesError={olderMessagesError}
                newerMessagesError={newerMessagesError}
                firstUnreadMessageId={firstUnreadMessageId}
                onRetryHistoryPage={retryHistoryPage}
                onBack={() => setSelectedConversationId(null)}
                isPeerTyping={isPeerTyping}
                isPeerOnline={isPeerOnline}
                peerLastSeenAt={peerLastSeenAt}
                onComposerTyping={notifyTyping}
                onStopTyping={stopTyping}
            />
        </main>
    );
};
