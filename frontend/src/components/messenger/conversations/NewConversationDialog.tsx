import { LoaderCircle, Search, SquarePen, X } from "lucide-react";
import { useRef, useState } from "react";

import { useAuth } from "../../../features/auth/useAuth";
import { useUserSearch } from "../../../features/users/useUserSearch";
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

// Получает состояния поиска пользователей из useUserSearch.
// Выбирает подсказку, загрузку, Retry, пустой результат или список найденных пользователей.
// Возвращает содержимое области результатов; открытие чата подключается следующим шагом.
const UserSearchResults = ({ search }: { search: ReturnType<typeof useUserSearch> }) => {
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
                <li key={user.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
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
                </li>
            ))}
        </ul>
    );
};

// Вызывается кнопкой New chat в header списка диалогов.
// Управляет окном и вводом, передаёт username в отдельный хук поиска.
// Возвращает trigger и модалку; запросы выполняются только при открытом окне.
export const NewConversationDialog = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const { authenticatedRequest } = useAuth();
    const search = useUserSearch({ query: searchQuery, isEnabled: isOpen, authenticatedRequest });

    // Получает новое состояние открытия от Radix.
    // При открытии очищает ввод; при закрытии отключает поиск, сохраняя текст до конца анимации.
    // Обновляет видимость окна, а отмену GET выполняет cleanup хука.
    const changeDialogOpen = (open: boolean) => {
        if (open) setSearchQuery("");
        setIsOpen(open);
    };

    // Получает нажатие крестика внутри поискового поля.
    // Очищает username и возвращает фокус в input.
    // Показывает начальную подсказку; прежний поиск отменит хук.
    const clearUserSearch = () => {
        setSearchQuery("");
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
                    <SquarePen size={20} strokeWidth={1.8} aria-hidden="true" />
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
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search by username…"
                            aria-label="Search users by username"
                        />
                        <button
                            type="button"
                            onClick={clearUserSearch}
                            className="flux-icon-button size-7 shrink-0 transition-[opacity,scale,background-color,color] duration-120 disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none"
                            disabled={!searchQuery}
                            aria-hidden={!searchQuery}
                            aria-label="Clear user search"
                        >
                            <X size={16} strokeWidth={1.8} aria-hidden="true" />
                        </button>
                    </div>
                </div>
                <UserSearchResults search={search} />
            </DialogContent>
        </Dialog>
    );
};
