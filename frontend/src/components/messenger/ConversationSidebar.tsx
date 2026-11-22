import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Conversation } from "../../features/conversations/conversations.types";
import type { UserPresence } from "../../features/realtime/useConversationPresence";
import type { RequestRetryState } from "../../lib/request-retry";
import { getInitials } from "../../lib/get-initials";
import { RequestRetryStatus } from "./RequestRetryStatus";
import { NewConversationDialog } from "./conversations/NewConversationDialog";
import { MessengerMobileNav } from "./MessengerMobileNav";
import type { MessengerSection } from "./NavRail";

type ConversationSidebarProps = {
    conversations: Conversation[];
    presenceByUserId: ReadonlyMap<string, UserPresence>;
    loading: boolean;
    isOffline: boolean;
    error: string | null;
    refreshError: string | null;
    requestRetry: RequestRetryState | null;
    onRetryConversations: () => void;
    selectedConversationId: string | null;
    onSelectConversation: (id: string) => void;
    onDirectConversationOpened: (conversation: Conversation) => void;
    onSelectSection: (section: MessengerSection) => void;
};

// Получает дату последнего сообщения или дату создания пустого диалога.
// Для сегодняшнего диалога показываем время, для более старого — дату.
// Возвращает отформатированную строку для sidebar.
const formatConversationTime = (createdAt: string) => {
    const date = new Date(createdAt);

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

// Получает диалог, признаки выбора и online, а также обработчик открытия чата.
// Отображает одного собеседника из полученной conversation.
// Возвращает кнопку с аватаром, последним сообщением, временем и счётчиком непрочитанных.
const ConversationRow = ({
    conversation,
    selected,
    isOnline,
    onSelect,
}: {
    conversation: Conversation;
    selected: boolean;
    isOnline: boolean;
    onSelect: (id: string) => void;
}) => {
    const displayName = conversation.user?.name || conversation.user?.username || "Unknown user";
    const preview = conversation.lastMessage?.content ?? "No messages yet";
    const activityAt = conversation.lastMessage?.createdAt ?? conversation.createdAt;
    const unreadCount = conversation.unreadCount;
    const hasUnreadMessages = unreadCount > 0;
    const [lastPositiveUnreadCount, setLastPositiveUnreadCount] = useState(unreadCount);
    const displayedUnreadCount = hasUnreadMessages ? unreadCount : lastPositiveUnreadCount;

    // Положительное число показываем прямо из conversation в том же рендере, что и preview.
    // Последнее ненулевое число запоминаем только для анимации исчезновения при нуле.
    useEffect(() => {
        if (unreadCount <= 0) return;
        const timerId = window.setTimeout(() => {
            setLastPositiveUnreadCount(unreadCount);
        }, 0);
        return () => window.clearTimeout(timerId);
    }, [unreadCount]);

    return (
        <button
            type="button"
            className={`flux-conversation-row${selected ? " flux-conversation-row-selected" : ""}`}
            onClick={() => onSelect(conversation.id)}
            aria-pressed={selected}
        >
            <div className="flux-conversation-avatar relative">
                {conversation.user?.image ? (
                    <img
                        src={conversation.user.image}
                        alt=""
                        className="h-full w-full rounded-full object-cover"
                    />
                ) : (
                    getInitials(displayName) || "?"
                )}
                <span className="flux-presence-dot" data-online={isOnline} aria-hidden="true" />
                {isOnline && <span className="sr-only">Online</span>}
            </div>

            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-slate-800 dark:text-slate-100">
                        {displayName}
                    </p>
                    <time dateTime={activityAt} className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                        {formatConversationTime(activityAt)}
                    </time>
                </div>

                <div className="mt-0.5 flex items-center">
                    <p className="min-w-0 flex-1 truncate text-[13px] leading-4 text-slate-500 dark:text-slate-400">
                        {preview}
                    </p>
                    <span className="flux-conversation-unread-slot" data-visible={hasUnreadMessages}
                        aria-hidden={!hasUnreadMessages}>
                        <span className="min-w-0 overflow-hidden">
                            <span className="flux-conversation-unread">
                                <span aria-hidden="true">{displayedUnreadCount > 99 ? "99+" : displayedUnreadCount}</span>
                                <span className="sr-only">{displayedUnreadCount} unread messages</span>
                            </span>
                        </span>
                    </span>
                </div>
            </div>
        </button>
    );
};

// Получает диалоги, статусы собеседников и обработчики выбора/повтора загрузки.
// Фильтрует текущий список по имени или username без дополнительных запросов.
// Возвращает sidebar с поиском, диалогами и мобильной навигацией.
export const ConversationSidebar = ({
    conversations,
    presenceByUserId,
    loading,
    isOffline,
    error,
    refreshError,
    requestRetry,
    onRetryConversations,
    selectedConversationId,
    onSelectConversation,
    onDirectConversationOpened,
    onSelectSection,
}: ConversationSidebarProps) => {
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const normalizedSearchQuery = searchQuery.trim().replace(/^@/, "").toLowerCase();

    // Пустой запрос показывает все диалоги; остальные ищем по имени и username без учёта регистра.
    const matchingConversations = normalizedSearchQuery
        ? conversations.filter(({ user }) =>
              user?.name.toLowerCase().includes(normalizedSearchQuery) ||
              user?.username.toLowerCase().includes(normalizedSearchQuery),
          )
        : conversations;

    // Вызывается при нажатии кнопки очистки поиска.
    // Убирает введённый текст и возвращает фокус в поле.
    // Список снова показывает все диалоги, выбранный чат сохраняется.
    const clearConversationSearch = () => {
        setSearchQuery("");
        searchInputRef.current?.focus();
    };

    // Получает id диалога, выбранного через New chat.
    // Убирает фильтр списка и передаёт выбор в MessengerPage.
    // Показывает выбранный диалог в полном списке, включая только что созданный.
    const selectConversationFromUserSearch = (conversationId: string) => {
        setSearchQuery("");
        onSelectConversation(conversationId);
    };

    return (
        <aside className="flux-conversation-sidebar">
            <header className="flux-conversation-header">
                <div className="flex items-center gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="h-10 w-10 shrink-0 lg:hidden">
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

                    <h1 className="hidden text-xl font-semibold tracking-tight text-slate-900 dark:text-white lg:block">
                        Chats
                    </h1>

                    <div className="flux-conversation-search lg:col-span-2 lg:row-start-2">
                        <Search size={17} strokeWidth={1.8} aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search conversations..."
                            aria-label="Search conversations"
                        />
                        <button
                            type="button"
                            className="flux-icon-button size-7 shrink-0 transition-[opacity,scale,background-color,color] duration-120 disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none"
                            aria-label="Clear conversation search"
                            aria-hidden={!searchQuery}
                            disabled={!searchQuery}
                            onClick={clearConversationSearch}
                        >
                            <X size={16} strokeWidth={1.8} aria-hidden="true" />
                        </button>
                    </div>
                    <NewConversationDialog
                        conversations={conversations}
                        onDirectConversationOpened={onDirectConversationOpened}
                        onSelectConversation={selectConversationFromUserSearch}
                    />
                </div>
            </header>

            <div className="flux-conversation-list">
                {!loading && !isOffline && <RequestRetryStatus retry={requestRetry} error={refreshError} onRetry={onRetryConversations} />}
                {/* Показываем только одно состояние списка за раз. */}
                {loading ? (
                    <div className="flux-conversation-state" role={requestRetry ? undefined : "status"}>
                        {requestRetry ? <RequestRetryStatus retry={requestRetry} onRetry={onRetryConversations} /> :
                            isOffline ? "Waiting for a connection..." : "Loading conversations..."}
                    </div>
                ) : error ? (
                    <div className="flux-conversation-state">
                        <RequestRetryStatus retry={null} error={error} onRetry={onRetryConversations} />
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="flux-conversation-state">No conversations yet</div>
                ) : matchingConversations.length === 0 ? (
                    <div className="flux-conversation-state" role="status">No conversations found</div>
                ) : (
                    matchingConversations.map((conversation) => (
                        <ConversationRow
                            key={conversation.id}
                            conversation={conversation}
                            selected={conversation.id === selectedConversationId}
                            isOnline={conversation.user ? presenceByUserId.get(conversation.user.id)?.isOnline === true : false}
                            onSelect={onSelectConversation}
                        />
                    ))
                )}
            </div>

            <MessengerMobileNav activeSection="chats" onSelectSection={onSelectSection} />
        </aside>
    );
};
