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

import type { Conversation } from "../../features/conversations/conversations.api";
import type { Message } from "../../features/messages/messages.api";

type ChatPanelProps = {
    conversation: Conversation | null;
    messages: Message[];
    messagesLoading: boolean;
    messagesError: string | null;
    currentUserId: string | null;
};

type MessageBubbleProps = {
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

// Один bubble использует одинаковую систему spacer + metadata для всех текстов.
const MessageBubble = ({ message, isOwnMessage }: MessageBubbleProps) => (
    <div
        className={`flux-message-placeholder ${
            isOwnMessage
                ? "flux-message-placeholder-outgoing ml-auto"
                : "flux-message-placeholder-incoming"
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
}: ChatPanelProps) => {
    const conversationUser = conversation?.user;

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

            <div className="flux-chat-messages">
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
                        {messages.map((message) => (
                            <MessageBubble
                                key={message.id}
                                message={message}
                                isOwnMessage={message.senderId === currentUserId}
                            />
                        ))}
                    </div>
                )}
            </div>

            <footer className="shrink-0 border-t border-slate-200/60 p-3.5 dark:border-white/8 lg:p-4">
                <div className="flux-composer">
                    <button type="button" className="flux-composer-action" aria-label="Add attachment">
                        <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <input
                        type="text"
                        className="flux-composer-input"
                        placeholder={`Message ${conversationUser.name}...`}
                        aria-label={`Message ${conversationUser.name}`}
                    />
                    <button type="button" className="flux-composer-emoji" aria-label="Choose emoji">
                        <Smile size={18} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-composer-send" aria-label="Send message">
                        <SendHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                </div>
            </footer>
        </section>
    );
};
