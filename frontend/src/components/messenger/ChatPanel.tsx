import {
    CheckCheck,
    MessageCircleMore,
    MoreHorizontal,
    Phone,
    Plus,
    Search,
    SendHorizontal,
    Smile,
    Video,
} from "lucide-react";
import { useState, type FormEvent, type RefObject } from "react";

import type { Conversation } from "../../features/conversations/conversations.api";
import type { Message } from "../../features/messages/messages.api";

type ChatPanelProps = {
    conversation: Conversation | null;
    messages: Message[];
    messagesLoading: boolean;
    messagesError: string | null;
    currentUserId: string | null;
    onSendMessage: (content: string) => Promise<void>;
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    onMessagesScroll: () => void;
    isLoadingOlder: boolean;
    olderMessagesError: string | null;
};

type MessageRowProps = {
    message: Message;
    isOwnMessage: boolean;
};

const getInitials = (name: string) => {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
};

const formatMessageTime = (createdAt: string) => {
    const date = new Date(createdAt);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    return new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
};

// Одна строка сообщения использует общую систему spacer + metadata.
const MessageRow = ({ message, isOwnMessage }: MessageRowProps) => (
    <div
        className={`flux-message-placeholder ${
            isOwnMessage ? "flux-message-placeholder-outgoing ml-auto" : "flux-message-placeholder-incoming"
        }`}
    >
        <span className="flux-message-text">{message.content}</span>
        <span className="flux-message-meta-spacer" aria-hidden="true" />
        <span className="flux-message-meta">
            <time>{formatMessageTime(message.createdAt)}</time>
            {isOwnMessage && <CheckCheck size={16} strokeWidth={2} aria-label="Read" />}
        </span>
    </div>
);

export const ChatPanel = ({
    conversation,
    messages,
    messagesLoading,
    messagesError,
    currentUserId,
    onSendMessage,
    messagesContainerRef,
    onMessagesScroll,
    isLoadingOlder,
    olderMessagesError,
}: ChatPanelProps) => {
    const conversationUser = conversation?.user;

    // Отправка сообщения:
    const [content, setContent] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        // отменяет form
        event.preventDefault();

        const trimmedContent = content.trim();

        if (!trimmedContent || isSending) {
            return;
        }

        setIsSending(true);
        setSendError(null);

        try {
            await onSendMessage(trimmedContent);
            setContent("");
        } catch (requestError) {
            setSendError(requestError instanceof Error ? requestError.message : "Failed to send message");
        } finally {
            setIsSending(false);
        }
    };

    if (!conversationUser) {
        return (
            <section className="flux-chat-panel">
                <div className="flux-chat-empty">
                    <MessageCircleMore size={28} strokeWidth={1.6} aria-hidden="true" />
                    <div>
                        <h2>Select a conversation to start chatting</h2>
                        <p>Choose a conversation from the list to see the chat.</p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="flux-chat-panel">
            <header className="flux-chat-header">
                <div className="flex items-center gap-3">
                    <div className="flux-chat-avatar overflow-hidden">
                        {conversationUser.image ? (
                            <img src={conversationUser.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                            getInitials(conversationUser.name) || "?"
                        )}
                    </div>
                    <div>
                        <h2 className="text-base font-semibold leading-5 text-slate-900 dark:text-slate-50">
                            {conversationUser.name}
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            @{conversationUser.username}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    <button type="button" className="flux-icon-button" aria-label="Search chat">
                        <Search size={19} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-icon-button" aria-label="Call">
                        <Phone size={19} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-icon-button" aria-label="Video call">
                        <Video size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-icon-button" aria-label="More options">
                        <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                </div>
            </header>

            <div ref={messagesContainerRef} className="flux-chat-messages" onScroll={onMessagesScroll}>
                {messagesLoading ? (
                    <div className="flux-chat-content-state" role="status">
                        Loading messages...
                    </div>
                ) : messagesError ? (
                    <div className="flux-chat-content-state text-rose-600 dark:text-rose-300" role="alert">
                        {messagesError}
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flux-chat-content-state">No messages yet</div>
                ) : (
                    <div className="flux-message-stack">
                        {isLoadingOlder && <div className="flux-load-older">Loading older messages...</div>}
                        {olderMessagesError && (
                            <div className="flux-load-older-error" role="alert">
                                {olderMessagesError}
                            </div>
                        )}
                        {messages.map((message) => (
                            <MessageRow
                                key={message.id}
                                message={message}
                                isOwnMessage={message.senderId === currentUserId}
                            />
                        ))}
                    </div>
                )}
            </div>

            <footer className="shrink-0 border-t border-slate-200/60 p-3.5 dark:border-white/8 lg:p-4">
                <form className="flux-composer" onSubmit={handleSubmit}>
                    <button type="button" className="flux-composer-action" aria-label="Add attachment">
                        <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <input
                        type="text"
                        className="flux-composer-input"
                        placeholder={`Message ${conversationUser.name}...`}
                        aria-label={`Message ${conversationUser.name}`}
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        disabled={isSending}
                    />
                    <button type="button" className="flux-composer-emoji" aria-label="Choose emoji">
                        <Smile size={18} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button
                        type="submit"
                        className="flux-composer-send cursor-pointer"
                        aria-label="Send message"
                        disabled={isSending || !content.trim()}
                    >
                        <SendHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                </form>
                {sendError && (
                    <p className="mt-2 text-center text-xs text-rose-600 dark:text-rose-300" role="alert">
                        {sendError}
                    </p>
                )}
            </footer>
        </section>
    );
};
