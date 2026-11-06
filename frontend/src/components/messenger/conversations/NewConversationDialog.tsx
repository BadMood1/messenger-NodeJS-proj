import { ArrowRight, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useRef, useState } from "react";

import { useAuth } from "../../../features/auth/useAuth";
import { useUserSearch } from "../../../features/users/useUserSearch";
import { useOpenDirectConversation } from "../../../features/conversations/useOpenDirectConversation";
import type { Conversation } from "../../../features/conversations/conversations.types";
import { getInitials } from "../../../lib/get-initials";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from "../../ui/dialog";
import { RequestRetryStatus } from "../RequestRetryStatus";

type NewConversationDialogProps = {
    conversations: Conversation[];
    onDirectConversationOpened: (conversation: Conversation) => void;
    onSelectConversation: (conversationId: string) => void;
};

type UserSearchResultsProps = {
    search: ReturnType<typeof useUserSearch>;
    openingUserId: string | null;
    onOpenConversationForUser: (userId: string) => Promise<void>;
};

// Получает состояния поиска, id ожидающего пользователя и обработчик выбора.
// Выбирает подсказку, загрузку, Retry, пустой результат или кнопки найденных пользователей.
// Возвращает результаты; во время POST показывает loader выбранной строки и блокирует повторные клики.
const UserSearchResults = ({ search, openingUserId, onOpenConversationForUser }: UserSearchResultsProps) => {
    const { users, isLoading, error, requestRetry, isSearchQueryLongEnough, retryUserSearch } = search;

    if (!isSearchQueryLongEnough) {
        return <p className="flux-conversation-state flex-1">Enter at least 2 characters to search.</p>;
    }
    if (error || requestRetry) {
        return (
            <div className="flex flex-1 items-center justify-center p-4">
                <RequestRetryStatus retry={requestRetry} error={error} onRetry={retryUserSearch} />
            </div>
        );
    }
    if (isLoading) {
        return (
            <div className="flux-conversation-state flex-1 gap-2" role="status">
                <LoaderCircle
                    size={18}
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                />
                Searching…
            </div>
        );
    }
    if (users.length === 0) {
        return (
            <p className="flux-conversation-state flex-1" role="status">
                No users found.
            </p>
        );
    }

    return (
        <ul
            className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3"
            aria-label="Found users"
        >
            {users.map((user) => (
                <li key={user.id}>
                    <button
                        type="button"
                        className="flux-conversation-row disabled:opacity-60"
                        disabled={openingUserId !== null}
                        aria-busy={openingUserId === user.id}
                        aria-label={`Open chat with @${user.username}`}
                        onClick={() => void onOpenConversationForUser(user.id)}
                    >
                        <div className="flux-conversation-avatar overflow-hidden" aria-hidden="true">
                            {user.image ? (
                                <img src={user.image} alt="" className="size-full object-cover" />
                            ) : (
                                getInitials(user.name || user.username)
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{user.name || user.username}</p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                @{user.username}
                            </p>
                        </div>
                        {openingUserId === user.id ? (
                            <LoaderCircle
                                size={18}
                                className="shrink-0 animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                            />
                        ) : (
                            <ArrowRight
                                size={17}
                                className="shrink-0 text-slate-400 dark:text-slate-500"
                                aria-hidden="true"
                            />
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
};

// Вызывается кнопкой New chat в header списка диалогов.
// Управляет окном, поисковым вводом и передачей выбранного диалога родителю.
// Возвращает trigger и модалку; запросы выполняются только при открытом окне.
export const NewConversationDialog = ({
    conversations,
    onDirectConversationOpened,
    onSelectConversation,
}: NewConversationDialogProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const { authenticatedRequest } = useAuth();
    const search = useUserSearch({ query: searchQuery, isEnabled: isOpen, authenticatedRequest });

    // !!! Получает готовый диалог из списка либо ответа POST.
    const handleConversationReady = (conversation: Conversation) => {
        onDirectConversationOpened(conversation); // обновл. список. Вызыв. handleDirectConversationOpened из useConversations
        onSelectConversation(conversation.id); // выбир. чат. selectConversationFromUserSearch из Sidebar
        setIsOpen(false); // закрываем окно поиска
    };

    const {
        openingUserId,
        openingError,
        openConversationForUser,
        cancelOpeningConversation,
        resetConversationOpening,
    } = useOpenDirectConversation({
        isEnabled: isOpen,
        conversations,
        authenticatedRequest,
        onConversationReady: handleConversationReady,
    });

    // Получает новое состояние открытия от Radix.
    // При открытии очищает ввод и ошибку; при закрытии сразу отменяет POST.
    // Меняет видимость, сохраняя содержимое на время анимации; GET отменит cleanup поиска.
    const changeDialogOpen = (open: boolean) => {
        if (open) {
            resetConversationOpening();
            search.clearUserSearchResults();
            setSearchQuery("");
        } else {
            cancelOpeningConversation();
        }
        setIsOpen(open);
    };

    // Получает новый текст из поискового поля.
    // Сбрасывает ошибку открытия предыдущего пользователя и обновляет username.
    // Передаёт новый ввод в существующий debounce поиска.
    const changeUserSearch = (query: string) => {
        resetConversationOpening();
        setSearchQuery(query);
    };

    // Получает нажатие крестика внутри поискового поля.
    // Очищает username и возвращает фокус в input.
    // Показывает начальную подсказку; прежний поиск отменит хук.
    const clearUserSearch = () => {
        search.clearUserSearchResults();
        changeUserSearch("");
        searchInputRef.current?.focus();
    };

    return (
        <Dialog open={isOpen} onOpenChange={changeDialogOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="flux-icon-button shrink-0 lg:col-start-2 lg:row-start-1"
                    aria-label="New chat"
                    title="New chat"
                >
                    <Plus size={22} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </DialogTrigger>
            <DialogContent
                className="h-[min(32rem,calc(100dvh-2rem))] gap-0 p-0"
                onOpenAutoFocus={(event) => {
                    // Сразу фокусируем поиск, а не первую кнопку Close в header.
                    event.preventDefault();
                    searchInputRef.current?.focus();
                }}
            >
                <div className="shrink-0 border-b border-blue-100/70 p-4 dark:border-white/7">
                    <div className="flex items-center justify-between gap-3">
                        <DialogTitle>New chat</DialogTitle>
                        <DialogClose asChild>
                            <button type="button" className="flux-icon-button" aria-label="Close new chat">
                                <X size={18} aria-hidden="true" />
                            </button>
                        </DialogClose>
                    </div>
                    <DialogDescription>Find someone by their username.</DialogDescription>
                    <div className="flux-conversation-search mt-4">
                        <Search size={17} strokeWidth={1.8} aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={searchQuery}
                            disabled={openingUserId !== null}
                            onChange={(event) => changeUserSearch(event.target.value)}
                            placeholder="Search by username…"
                            aria-label="Search users by username"
                        />
                        <button
                            type="button"
                            onClick={clearUserSearch}
                            className="flux-icon-button size-7 shrink-0 transition-[opacity,scale,background-color,color] duration-120 disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none"
                            disabled={!searchQuery || openingUserId !== null}
                            aria-hidden={!searchQuery}
                            aria-label="Clear user search"
                        >
                            <X size={16} strokeWidth={1.8} aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <UserSearchResults
                    search={search}
                    openingUserId={openingUserId}
                    onOpenConversationForUser={openConversationForUser}
                />
                {openingError && (
                    <div className="shrink-0 border-t border-blue-100/70 dark:border-white/7">
                        <RequestRetryStatus
                            retry={null}
                            error={openingError.message}
                            onRetry={() => void openConversationForUser(openingError.userId)}
                        />
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
