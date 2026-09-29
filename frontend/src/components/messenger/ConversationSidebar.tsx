import { MessageCircleMore, Search, UserRound, UsersRound } from "lucide-react";

import type { Conversation } from "../../features/conversations/conversations.api";

type ConversationSidebarProps = {
    conversations: Conversation[];
    loading: boolean;
    error: string | null;
    selectedConversationId: string | null;
    onSelectConversation: (id: string) => void;
};

// Получаем до двух первых букв имени для avatar без картинки.
const getInitials = (name: string) => {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
};

// Для сегодняшнего диалога показываем время, для более старого — дату.
const formatConversationTime = (updatedAt: string) => {
    const date = new Date(updatedAt);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
        return new Intl.DateTimeFormat("en", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).format(date);
    }

    return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }).format(date);
};

// Отображает одного собеседника из полученной conversation.
const ConversationRow = ({
    conversation,
    selected,
    onSelect,
}: {
    conversation: Conversation;
    selected: boolean;
    onSelect: (id: string) => void;
}) => {
    const displayName = conversation.user?.name || conversation.user?.username || "Unknown user";
    const preview = conversation.user ? `@${conversation.user.username}` : "User unavailable";

    return (
        <button
            type="button"
            className={`flux-conversation-row${selected ? " flux-conversation-row-selected" : ""}`}
            onClick={() => onSelect(conversation.id)}
            aria-pressed={selected}
        >
            <div className="flux-conversation-avatar">
                {conversation.user?.image ? (
                    <img
                        src={conversation.user.image}
                        alt=""
                        className="h-full w-full rounded-full object-cover"
                    />
                ) : (
                    getInitials(displayName) || "?"
                )}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-slate-800 dark:text-slate-100">
                        {displayName}
                    </p>
                    <time className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                        {formatConversationTime(conversation.updatedAt)}
                    </time>
                </div>

                <p className="mt-0.5 truncate text-[13px] leading-4 text-slate-500 dark:text-slate-400">
                    {preview}
                </p>
            </div>
        </button>
    );
};

export const ConversationSidebar = ({
    conversations,
    loading,
    error,
    selectedConversationId,
    onSelectConversation,
}: ConversationSidebarProps) => (
    <aside className="flux-conversation-sidebar">
        <header className="flux-conversation-header">
            <div className="flex items-center gap-3 md:block">
                <div className="h-10 w-10 shrink-0 md:hidden">
                    <img
                        src="/brand/logo-light.png"
                        alt="FLUX"
                        className="h-10 w-10 object-contain dark:hidden"
                    />
                    <img
                        src="/brand/logo-dark.png"
                        alt="FLUX"
                        className="hidden h-10 w-10 object-contain dark:block"
                    />
                </div>

                <h1 className="hidden text-xl font-semibold tracking-tight text-slate-900 dark:text-white md:block">
                    Chats
                </h1>

                <label className="flux-conversation-search">
                    <Search size={17} strokeWidth={1.8} aria-hidden="true" />
                    <input
                        type="search"
                        placeholder="Search conversations..."
                        aria-label="Search conversations"
                    />
                </label>
            </div>
        </header>

        <div className="flux-conversation-list">
            {/* Показываем только одно состояние списка за раз. */}
            {loading ? (
                <div className="flux-conversation-state" role="status">
                    Loading conversations...
                </div>
            ) : error ? (
                <div className="flux-conversation-state text-rose-600 dark:text-rose-300" role="alert">
                    {error}
                </div>
            ) : conversations.length === 0 ? (
                <div className="flux-conversation-state">No conversations yet</div>
            ) : (
                conversations.map((conversation) => (
                    <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        selected={conversation.id === selectedConversationId}
                        onSelect={onSelectConversation}
                    />
                ))
            )}
        </div>

        <nav className="flux-mobile-nav" aria-label="Мобильная навигация">
            <button type="button" className="text-blue-600 dark:text-cyan-300">
                <MessageCircleMore size={20} strokeWidth={1.8} aria-hidden="true" />
                Chats
            </button>
            <button type="button">
                <UsersRound size={20} strokeWidth={1.8} aria-hidden="true" />
                Friends
            </button>
            <button type="button">
                <UserRound size={20} strokeWidth={1.8} aria-hidden="true" />
                Profile
            </button>
        </nav>
    </aside>
);
