import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ChatPanel } from "../components/messenger/chat/ChatPanel";
import { ConnectionStatus } from "../components/messenger/ConnectionStatus";
import { ConversationSidebar } from "../components/messenger/ConversationSidebar";
import { NavRail, type MessengerSection } from "../components/messenger/NavRail";
import { FriendsPanel } from "../components/messenger/friends/FriendsPanel";
import { useAuth } from "../features/auth/useAuth";
import { useConversations } from "../features/conversations/useConversations";
import type { Conversation } from "../features/conversations/conversations.types";
import { useConversationRead } from "../features/conversations/useConversationRead";
import { useFriendshipLists } from "../features/friends/useFriendshipLists";
import { useConversationMessages } from "../features/messages/useConversationMessages";
import { useLastVisibleMessage } from "../features/messages/scroll/useLastVisibleMessage";
import type { Message, MessageDeletedEvent } from "../features/messages/messages.types";
import { useRealtimeConnection } from "../features/realtime/useRealtimeConnection";

export const MessengerPage = () => {
    // ------- AUTH И СОСТОЯНИЕ СТРАНИЦЫ -------
    const { user, accessToken, authenticatedRequest, getAccessToken, resolveAccessTokenAfter401 } = useAuth();
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [activeSection, setActiveSection] = useState<MessengerSection>("chats");
    const shellRef = useRef<HTMLElement | null>(null); // ссылка на элемент main
    const isAuthenticated = Boolean(accessToken);

    // ------- ДРУЗЬЯ И ЗАЯВКИ -------
    // Списки принадлежат странице: socket обновляет их и при скрытой панели Friends.
    const friendshipLists = useFriendshipLists({
        authenticatedRequest,
        isActive: isAuthenticated && activeSection === "friends",
    });

    // ------- СПИСОК ДИАЛОГОВ -------
    // Берём данные о диалогах из нашего хука
    const {
        conversations,
        loading,
        error,
        refreshError,
        requestRetry: conversationsRetry,
        retryConversations,
        handleDirectConversationOpened,
        handleConversationRead,
        handleLocalConversationRead,
        handleConversationReadReceipt,
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
        hasOlderMessages,
        isLatestHistoryLoaded,
        isScrollToLatestButtonVisible,
        isLoadingLatest,
        scrollToLatestMessages,
        messagesLoading,
        messagesError,
        initialRetry,
        historySyncRetry,
        paginationRetry,
        retryInitialMessages,
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

    // ------- ВИДИМОЕ СООБЩЕНИЕ ДЛЯ ГРАНИЦЫ ПРОЧТЕНИЯ -------
    const lastVisibleMessage = useLastVisibleMessage({
        conversationId: selectedConversation?.id ?? null,
        messages,
        messagesContainerRef,
        isEnabled: isAuthenticated && activeSection === "chats" && !messagesLoading && !messagesError,
    });

    // Увиденную позицию показываем прочитанной до следующей отрисовки; сервер сохраняет её отдельно.
    useLayoutEffect(() => {
        if (activeSection === "chats") {
            handleLocalConversationRead(lastVisibleMessage, messages, isLatestHistoryLoaded);
        }
    }, [activeSection, lastVisibleMessage, messages, isLatestHistoryLoaded, handleLocalConversationRead]);

    // ------- СОХРАНЕНИЕ ПРОЧТЕНИЯ ЧЕРЕЗ REST -------
    const { resumeReadPositionSync } = useConversationRead({
        conversationId: selectedConversation?.id ?? null,
        currentUserId: user?.id ?? null,
        // Скрытый чат не создаёт новых позиций прочтения; уже увиденные хук сохранит как обычно.
        lastVisibleMessage: activeSection === "chats" ? lastVisibleMessage : null,
        initialReadState: selectedConversation?.readState ?? null,
        authenticatedRequest,
        onReadPositionSaved: handleConversationRead,
        isEnabled: isAuthenticated,
    });

    // ------- SOCKET-СОБЫТИЯ СООБЩЕНИЙ -------
    // Получает новое сообщение из socket.
    // Передаёт его в историю открытого чата и в список диалогов.
    // Обновляет оба участка UI одним событием.
    const onMessageCreated = useCallback(
        (message: Message) => {
            handleMessageCreated(message); // обновл. историю
            handleConversationMessage(message, "created"); // одновременно обновл. preview и счётчик sidebar
        },
        [handleMessageCreated, handleConversationMessage],
    );

    // Получает изменённое сообщение из socket.
    // Передаёт правку в историю и в preview диалога.
    // Обновляет текст, не меняя дату отправки сообщения.
    const onMessageUpdated = useCallback(
        (message: Message) => {
            handleMessageUpdated(message);
            handleConversationMessage(message, "updated");
        },
        [handleMessageUpdated, handleConversationMessage],
    );

    // Получает id удалённого сообщения, его чат и новый preview из socket.
    // Передаёт удаление в историю и в обработчик списка диалогов.
    // Убирает сообщение из чата и обновляет последний текст sidebar.
    const onMessageDeleted = useCallback(
        (message: MessageDeletedEvent) => {
            handleMessageDeleted(message);
            handleConversationMessageDeleted(message);
        },
        [handleMessageDeleted, handleConversationMessageDeleted],
    );

    // Получает id сообщения из подтверждения удаления.
    // Удаляет его через message hook и передаёт результат DELETE в sidebar даже без socket.
    // Обновляет preview тем же обработчиком, который принимает socket-событие; повторы пропускаются.
    const deleteMessageAndUpdateConversationPreview = useCallback(async (messageId: string) => {
        const deletion = await deleteMessage(messageId);
        if (deletion) handleConversationMessageDeleted(deletion);
    }, [deleteMessage, handleConversationMessageDeleted]);

    // ------- СИНХРОНИЗАЦИЯ ПОСЛЕ CONNECT / RECONNECT -------
    // Получает сигнал об успешном подключении socket.
    // Запрашивает актуальную историю открытого чата и список диалогов.
    // Обновляет сообщения и sidebar, возобновляет очередь прочтения после connect/reconnect.
    const onConnected = useCallback(() => {
        requestHistorySync(); // сверка истории открытого чата
        retryConversations(); // обновление списка диалогов, в том числе после исчерпания retry
        resumeReadPositionSync(); // сохраняем позиции, накопленные без связи, включая закрытые чаты
    }, [requestHistorySync, retryConversations, resumeReadPositionSync]);

    // После реального online возобновляем загрузки, даже если socket пока не подключился.
    useEffect(() => {
        window.addEventListener("online", onConnected);
        return () => window.removeEventListener("online", onConnected);
    }, [onConnected]);

    // ------- ПОДКЛЮЧЕНИЕ SOCKET -------
    // дальше эти данные передадим в ChatPannel
    const {
        connectionStatus,
        isPeerTyping,
        notifyTyping,
        stopTyping,
        presenceByUserId,
        isPeerOnline,
        peerLastSeenAt,
    } = useRealtimeConnection({
        enabled: isAuthenticated,
        conversations,
        conversationId: selectedConversationId,
        conversationUserId: selectedConversation?.user?.id ?? null,
        getAccessToken,
        resolveAccessTokenAfter401,
        onMessageCreated, // socket получает событие, message hook обновляет messages
        onMessageUpdated,
        onMessageDeleted,
        onConversationRead: handleConversationRead,
        onConversationReadReceipt: handleConversationReadReceipt,
        onFriendRequestCreated: friendshipLists.handleFriendRequestCreated,
        onFriendshipChanged: friendshipLists.handleFriendshipChanged,
        onConnected,
    });
    const isOffline = connectionStatus === "offline";

    // ------- ПЕРЕКЛЮЧЕНИЕ РАЗДЕЛОВ -------
    // Получает Chats или Friends из desktop/mobile навигации.
    // При уходе в Friends останавливает typing, затем меняет видимый раздел.
    // Сохраняет выбранный чат и его состояние для возвращения в Chats.
    const selectMessengerSection = (section: MessengerSection) => {
        if (section === "friends") stopTyping();
        setActiveSection(section);
    };

    // ------- ВЫБОР ДИАЛОГА -------
    const handleSelectConversation = (conversationId: string) => {
        if (conversationId !== selectedConversationId) {
            setSelectedConversationId(conversationId);
        }
    };

    // Получает Back или Escape в открытом разделе Chats.
    // Сбрасывает выбранный id; message hook сам очищает историю.
    // Сохраняет ссылку обработчика между рендерами для memo(ChatPanel).
    const closeConversation = useCallback(() => setSelectedConversationId(null), []);

    // Получает готовый DIRECT после нажатия на друга.
    // Добавляет его в sidebar, выбирает id и возвращает раздел Chats.
    // Запускает существующую историю сообщений без отдельного message flow для Friends.
    const handleFriendConversationReady = (conversation: Conversation) => {
        handleDirectConversationOpened(conversation);
        handleSelectConversation(conversation.id);
        setActiveSection("chats");
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

            // В Friends выбранный чат скрыт: Escape не должен сбрасывать его id.
            if (event.key === "Escape" && activeSection === "chats") {
                closeConversation();
            }
        };

        window.addEventListener("keydown", closeConversationOnEscape);

        return () => {
            window.removeEventListener("keydown", closeConversationOnEscape);
        };
    }, [activeSection, closeConversation]);

    // ------- РЕНДЕР СТРАНИЦЫ -------
    return (
        // data-chat-open даёт css понять открыт ли чат, потом в css в зависимости от значения применяем display(none/flex)
        <main
            ref={shellRef}
            className="flux-messenger-shell"
            data-chat-open={activeSection === "chats" && Boolean(selectedConversation)}
        >
            <div className="flux-messenger-ambient" aria-hidden="true" />

            {/* ==================== NAVIGATION ==================== */}
            <NavRail
                username={user?.username}
                activeSection={activeSection}
                onSelectSection={selectMessengerSection}
            />

            <div className="flux-messenger-workspace" data-section={activeSection}>
                <div className="flux-sidebar-slot" inert={activeSection !== "chats"} aria-hidden={activeSection !== "chats"}>
                    {/* ==================== CONVERSATIONS ==================== */}
                    <ConversationSidebar
                        conversations={conversations}
                        presenceByUserId={presenceByUserId}
                        loading={loading || (isOffline && Boolean(error))}
                        isOffline={isOffline}
                        error={error}
                        refreshError={isOffline ? null : refreshError}
                        requestRetry={conversationsRetry}
                        onRetryConversations={retryConversations}
                        selectedConversationId={selectedConversationId}
                        onSelectConversation={handleSelectConversation}
                        onDirectConversationOpened={handleDirectConversationOpened}
                        onSelectSection={selectMessengerSection}
                    />
                </div>

                {/* ==================== CHAT ==================== */}
                <div className="flux-main-panel">
                    {/* Обе панели остаются смонтированы; inert исключает скрытую из фокуса и кликов. */}
                    <div className="flux-panel-view flux-panel-view-chat" data-active={activeSection === "chats"} inert={activeSection !== "chats"} aria-hidden={activeSection !== "chats"}>
                        <ChatPanel
                            key={selectedConversation?.id ?? "no-conversation"}
                            conversation={selectedConversation}
                            messages={messages}
                            hasOlderMessages={hasOlderMessages}
                            messagesLoading={messagesLoading}
                            messagesError={messagesError}
                            initialRetry={initialRetry}
                            historySyncRetry={historySyncRetry}
                            paginationRetry={paginationRetry}
                            onRetryInitialMessages={retryInitialMessages}
                            historySyncError={historySyncError}
                            onRetryHistorySync={requestHistorySync}
                            isOffline={isOffline}
                            currentUserId={user?.id ?? null}
                            onSendMessage={sendMessage}
                            onRetryMessage={retryMessage}
                            onEditMessage={editMessage}
                            onDeleteMessage={deleteMessageAndUpdateConversationPreview}
                            messagesContainerRef={messagesContainerRef}
                            onMessagesScroll={handleMessagesScroll}
                            isScrollToLatestButtonVisible={isScrollToLatestButtonVisible}
                            isLoadingLatest={isLoadingLatest}
                            onScrollToLatest={scrollToLatestMessages}
                            isLoadingOlder={isLoadingOlder}
                            isLoadingNewer={isLoadingNewer}
                            olderMessagesError={olderMessagesError}
                            newerMessagesError={newerMessagesError}
                            firstUnreadMessageId={firstUnreadMessageId}
                            onRetryHistoryPage={retryHistoryPage}
                            onBack={closeConversation}
                            isPeerTyping={isPeerTyping}
                            isPeerOnline={isPeerOnline}
                            peerLastSeenAt={peerLastSeenAt}
                            onComposerTyping={notifyTyping}
                            onStopTyping={stopTyping}
                        />
                    </div>
                    <div className="flux-panel-view flux-panel-view-friends" data-active={activeSection === "friends"} inert={activeSection !== "friends"} aria-hidden={activeSection !== "friends"}>
                        <FriendsPanel isActive={activeSection === "friends"} friendshipLists={friendshipLists} conversations={conversations}
                            onSelectSection={selectMessengerSection} onConversationReady={handleFriendConversationReady} />
                    </div>
                </div>
            </div>
            <ConnectionStatus status={connectionStatus} />
        </main>
    );
};
