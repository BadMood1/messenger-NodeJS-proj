import { ArrowDown, LoaderCircle } from "lucide-react";
import { Fragment, type RefObject } from "react";

import type { RequestRetryState } from "../../../lib/request-retry";
import type { Conversation } from "../../../features/conversations/conversations.types";
import type { Message, ClientMessage } from "../../../features/messages/messages.types";
import { getMessageDateSeparatorLabel } from "../../../features/messages/message-date-separators";
import { isMessageReadByPeer } from "../../../features/conversations/conversation-read-receipts";
import { MessageBubble } from "./MessageBubble";
import { ChatScrollDate } from "./ChatScrollDate";
import { RequestRetryStatus } from "../RequestRetryStatus";

type ChatMessageHistoryProps = {
    conversation: Conversation;
    messages: ClientMessage[];
    hasOlderMessages: boolean;
    messagesLoading: boolean;
    messagesError: string | null;
    initialRetry: RequestRetryState | null;
    paginationRetry: RequestRetryState | null;
    onRetryInitialMessages: () => void;
    isOffline: boolean;
    currentUserId: string | null;
    onRetryMessage: (messageId: string) => void;
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    onMessagesScroll: () => void;
    isScrollToLatestButtonVisible: boolean;
    isLoadingLatest: boolean;
    onScrollToLatest: () => void;
    isLoadingOlder: boolean;
    isLoadingNewer: boolean;
    olderMessagesError: string | null;
    newerMessagesError: string | null;
    firstUnreadMessageId: string | null;
    onRetryHistoryPage: () => void;
    actionsDisabled: boolean;
    onEdit: (message: Message) => void;
    onDelete: (message: Message) => void;
    onReply: (message: Message) => void;
};

// Получает сообщения, состояния загрузки, scroll-ref и обработчики действий.
// Рисует существующую историю с датами, unread-разделителем и состояниями Retry.
// Возвращает область скролла, плавающую дату и кнопку перехода вниз.
export const ChatMessageHistory = ({
    conversation,
    messages,
    hasOlderMessages,
    messagesLoading,
    messagesError,
    initialRetry,
    paginationRetry,
    onRetryInitialMessages,
    isOffline,
    currentUserId,
    onRetryMessage,
    messagesContainerRef,
    onMessagesScroll,
    isScrollToLatestButtonVisible,
    isLoadingLatest,
    onScrollToLatest,
    isLoadingOlder,
    isLoadingNewer,
    olderMessagesError,
    newerMessagesError,
    firstUnreadMessageId,
    onRetryHistoryPage,
    actionsDisabled,
    onEdit,
    onDelete,
    onReply,
}: ChatMessageHistoryProps) => {
    const currentDate = new Date();

    return (
        <div className="flux-chat-history">
            <div ref={messagesContainerRef} className="flux-chat-messages" onScroll={onMessagesScroll}>
                {messagesLoading ? (
                    <div className="flux-chat-content-state" role={initialRetry ? undefined : "status"}>
                        {initialRetry ? (
                            <RequestRetryStatus retry={initialRetry} onRetry={onRetryInitialMessages} />
                        ) : isOffline ? (
                            "Waiting for a connection..."
                        ) : (
                            "Loading messages..."
                        )}
                    </div>
                ) : messagesError ? (
                    <div
                        className={`flux-chat-content-state${isOffline ? "" : " text-rose-600 dark:text-rose-300"}`}
                        role={isOffline ? "status" : undefined}
                    >
                        {isOffline ? (
                            "Waiting for a connection..."
                        ) : (
                            <RequestRetryStatus
                                retry={null}
                                error={messagesError}
                                onRetry={onRetryInitialMessages}
                            />
                        )}
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flux-chat-content-state">No messages yet</div>
                ) : (
                    <div className="flux-message-stack">
                        {isLoadingOlder && !paginationRetry && (
                            <div className="flux-load-older" role="status">
                                Loading older messages...
                            </div>
                        )}
                        {!isOffline && ((isLoadingOlder && paginationRetry) || olderMessagesError) && (
                            <div className="flux-load-older flux-load-older-retry">
                                <RequestRetryStatus
                                    retry={isLoadingOlder ? paginationRetry : null}
                                    error={olderMessagesError}
                                    onRetry={onRetryHistoryPage}
                                />
                            </div>
                        )}
                        {messages.map((message, index) => {
                            // Если выше ещё есть история, первое загруженное сообщение не считаем началом дня.
                            const dateSeparatorLabel =
                                index === 0 && hasOlderMessages
                                    ? null
                                    : getMessageDateSeparatorLabel(
                                          message.createdAt,
                                          messages[index - 1]?.createdAt,
                                          currentDate,
                                      );
                            // clientMessageId сохраняет тот же bubble после замены temp id на server id.
                            return (
                                <Fragment
                                    key={
                                        message.clientMessageId
                                            ? `client:${message.senderId}:${message.clientMessageId}`
                                            : message.id
                                    }
                                >
                                    {dateSeparatorLabel && (
                                        <div
                                            className="flux-message-day"
                                            data-date-separator
                                            role="separator"
                                            aria-label={dateSeparatorLabel}
                                        >
                                            <span>{dateSeparatorLabel}</span>
                                        </div>
                                    )}
                                    {message.id === firstUnreadMessageId && (
                                        <div
                                            className="flux-message-day"
                                            data-unread-separator
                                            role="separator"
                                            aria-label="Unread messages"
                                        >
                                            <span>Unread messages</span>
                                        </div>
                                    )}
                                    <MessageBubble
                                        message={message}
                                        isOwnMessage={message.senderId === currentUserId}
                                        isRead={isMessageReadByPeer(message, conversation.peerReadState)}
                                        actionsDisabled={actionsDisabled}
                                        onEdit={onEdit}
                                        onDelete={onDelete}
                                        onReply={onReply}
                                        onRetry={onRetryMessage}
                                    />
                                </Fragment>
                            );
                        })}
                        {isLoadingNewer && !isLoadingLatest && !paginationRetry && (
                            <div
                                className="self-center py-1 text-xs text-slate-500 dark:text-slate-400"
                                role="status"
                            >
                                Loading newer messages...
                            </div>
                        )}
                        {!isOffline && ((isLoadingNewer && paginationRetry) || newerMessagesError) && (
                            <div className="self-center">
                                <RequestRetryStatus
                                    retry={isLoadingNewer ? paginationRetry : null}
                                    error={newerMessagesError}
                                    onRetry={onRetryHistoryPage}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
            {/* Пока верх занят загрузкой или ошибкой, плавающую дату не выводим. */}
            {!isLoadingOlder && !olderMessagesError && (
                <ChatScrollDate
                    messages={messages}
                    messagesContainerRef={messagesContainerRef}
                    isEnabled={isScrollToLatestButtonVisible}
                />
            )}
            {/* Оставляем кнопку в DOM: и появление, и уход под composer проходят плавно. */}
            <button
                type="button"
                className="flux-scroll-to-latest"
                data-visible={isScrollToLatestButtonVisible}
                tabIndex={isScrollToLatestButtonVisible ? 0 : -1}
                aria-hidden={!isScrollToLatestButtonVisible}
                aria-label={
                    isLoadingLatest
                        ? "Loading latest messages"
                        : `Go to latest messages${conversation.unreadCount > 0 ? `, ${conversation.unreadCount} unread messages` : ""}`
                }
                aria-busy={isLoadingLatest}
                disabled={isLoadingLatest || !isScrollToLatestButtonVisible}
                onClick={onScrollToLatest}
            >
                {conversation.unreadCount > 0 && (
                    <span className="flux-conversation-unread absolute -top-2.5 right-0" aria-hidden="true">
                        {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                    </span>
                )}
                {isLoadingLatest ? (
                    <LoaderCircle
                        size={20}
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                    />
                ) : (
                    <ArrowDown size={20} strokeWidth={1.8} aria-hidden="true" />
                )}
            </button>
        </div>
    );
};
