import { ArrowRight, Clock3, LoaderCircle, Search, UserCheck, UserPlus, X } from "lucide-react";
import { useRef, useState } from "react";

import { useAuth } from "../../../features/auth/useAuth";
import { useSendFriendRequest } from "../../../features/friends/useSendFriendRequest";
import type { FriendRequest, FriendshipStatusChange } from "../../../features/friends/friends.types";
import { useUserSearch } from "../../../features/users/useUserSearch";
import type { UserSearchResult } from "../../../features/users/users.types";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogTitle,
    DialogTrigger,
} from "../../ui/dialog";
import { getInitials } from "../../../lib/get-initials";
import { RequestRetryStatus } from "../RequestRetryStatus";

type AddFriendDialogProps = {
    onShowIncomingRequests: () => void;
    onRequestSent: (request: FriendRequest) => void;
    onFriendshipConflict: () => void;
    hasConfirmedOutgoingRequestSince: (userId: string, requestStartedAt: number) => boolean;
    friendshipChangesByUserId: Map<string, FriendshipStatusChange>;
};

type FriendSearchResultsProps = {
    onShowIncomingRequests: () => void;
    search: ReturnType<typeof useUserSearch>;
    requestSending: ReturnType<typeof useSendFriendRequest>;
    friendshipChangesByUserId: Map<string, FriendshipStatusChange>;
};

type FriendSearchStatusProps = {
    status: UserSearchResult["friendshipStatus"];
    isSending: boolean;
    isSendDisabled: boolean;
    onSendRequest: () => void;
    onShowIncomingRequests: () => void;
};

// Получает статус отношений, состояние отправки и обработчики Add friend и Incoming.
// Показывает существующую связь или действие; во время POST блокирует повторную отправку.
// Возвращает статус, loader выбранного пользователя или доступную кнопку действия.
const FriendSearchStatus = ({
    status,
    isSending,
    isSendDisabled,
    onSendRequest,
    onShowIncomingRequests,
}: FriendSearchStatusProps) => {
    if (status === "NONE") {
        return (
            <button
                type="button"
                className={`flux-friend-request-action min-h-11 px-2 whitespace-nowrap sm:min-h-9 sm:px-3${isSending ? " flux-friend-request-accept" : " flux-add-friend-action"}`}
                disabled={isSendDisabled}
                aria-busy={isSending}
                onClick={onSendRequest}
            >
                {isSending ? (
                    <LoaderCircle
                        size={15}
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                    />
                ) : (
                    <UserPlus size={15} aria-hidden="true" />
                )}
                {isSending ? "Sending…" : "Add friend"}
            </button>
        );
    }
    if (status === "PENDING_RECEIVED") {
        return (
            <button
                type="button"
                className="flux-friend-request-action min-h-11 px-2 whitespace-nowrap sm:min-h-9 sm:px-3"
                onClick={onShowIncomingRequests}
            >
                <span>
                    Incoming<span className="sr-only sm:not-sr-only"> request</span>
                </span>
                <ArrowRight size={14} aria-hidden="true" />
            </button>
        );
    }
    return (
        <span className="flex min-h-9 items-center gap-1.5 text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
            {status === "FRIENDS" ? (
                <UserCheck size={15} aria-hidden="true" />
            ) : (
                <Clock3 size={15} aria-hidden="true" />
            )}
            {status === "FRIENDS" ? "Friends" : "Request sent"}
        </span>
    );
};

// Получает состояния поиска и отправки, а также обработчик перехода в Incoming.
// Выбирает подсказку, загрузку, Retry или список с актуальными статусами и ошибкой отправки.
// Возвращает пользователей; GET остаётся в useUserSearch, а POST — в useSendFriendRequest.
const FriendSearchResults = ({
    search,
    requestSending,
    friendshipChangesByUserId,
    onShowIncomingRequests,
}: FriendSearchResultsProps) => {
    const { users, isLoading, error, requestRetry, isSearchQueryLongEnough, retryUserSearch } = search;
    const { sendingUserId, sendError, sendFriendRequestToUser } = requestSending;

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
            className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2.5 sm:space-y-2 sm:p-3"
            aria-label="Found users"
        >
            {users.map((user) => {
                const statusChange = friendshipChangesByUserId.get(user.id);
                // Если изменение пришло после начала этого GET, его статус новее ответа поиска.
                const friendshipStatus =
                    statusChange && statusChange.receivedAt >= search.requestStartedAt
                        ? statusChange.status
                        : user.friendshipStatus;
                return (
                    <li
                        key={user.id}
                        className="flux-friend-row grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-2.5 py-2 sm:gap-3 sm:px-3 sm:py-3.5"
                        aria-busy={sendingUserId === user.id}
                    >
                        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <span
                                className="flux-conversation-avatar size-9 overflow-hidden sm:size-11"
                                aria-hidden="true"
                            >
                                {user.image ? (
                                    <img src={user.image} alt="" className="size-full object-cover" />
                                ) : (
                                    getInitials(user.name || user.username)
                                )}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{user.name || user.username}</p>
                                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                                    @{user.username}
                                </p>
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <FriendSearchStatus
                                status={friendshipStatus}
                                isSending={sendingUserId === user.id}
                                isSendDisabled={sendingUserId !== null}
                                onSendRequest={() =>
                                    void sendFriendRequestToUser({ ...user, friendshipStatus })
                                }
                                onShowIncomingRequests={onShowIncomingRequests}
                            />
                        </div>
                        {sendError?.userId === user.id && (
                            <p
                                className="col-span-full wrap-break-word text-xs text-rose-600 dark:text-rose-300"
                                role="alert"
                            >
                                {sendError.message}
                            </p>
                        )}
                    </li>
                );
            })}
        </ul>
    );
};

// Получает обработчики перехода в Incoming, добавления исходящей заявки и сверки списков.
// Открывает поиск по username и связывает готовые хуки поиска и отправки заявки.
// Возвращает кнопку и модалку; успешный POST обновляет статус пользователя и список Outgoing.
export const AddFriendDialog = ({
    onShowIncomingRequests,
    onRequestSent,
    onFriendshipConflict,
    friendshipChangesByUserId,
    hasConfirmedOutgoingRequestSince,
}: AddFriendDialogProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const { authenticatedRequest } = useAuth();
    const search = useUserSearch({ query: searchQuery, isEnabled: isOpen, authenticatedRequest });

    // Получает сигнал о 409 при отправке заявки.
    // Перезапрашивает текущий поиск и передаёт сверку списков родительской панели.
    // Показывает фактические отношения вместо предположения об успешной отправке.
    const refreshFriendshipStatus = () => {
        search.retryUserSearch();
        onFriendshipConflict();
    };
    const requestSending = useSendFriendRequest({
        authenticatedRequest,
        onRequestSent,
        onFriendshipConflict: refreshFriendshipStatus,
        hasConfirmedOutgoingRequestSince,
    });

    // Получает открытие или закрытие окна от Radix.
    // При открытии очищает прошлый ввод и результаты, затем меняет видимость.
    // При закрытии сохраняет содержимое до конца анимации; useUserSearch отменяет GET.
    const changeDialogOpen = (open: boolean) => {
        if (open) {
            search.clearUserSearchResults();
            setSearchQuery("");
            requestSending.clearSendError();
        }
        setIsOpen(open);
    };

    // Получает нажатие крестика в поисковом поле.
    // Очищает ввод и прежние результаты, затем возвращает фокус в input.
    // Показывает начальную подсказку; useUserSearch отменяет прежний поиск.
    const clearUserSearch = () => {
        search.clearUserSearchResults();
        setSearchQuery("");
        searchInputRef.current?.focus();
    };

    // Получает выбор Incoming request у найденного пользователя.
    // Закрывает поиск и передаёт переключение списка родительской панели.
    // Показывает существующий список входящих без отдельной логики принятия заявки.
    const showIncomingRequests = () => {
        setIsOpen(false);
        onShowIncomingRequests();
    };

    return (
        <Dialog open={isOpen} onOpenChange={changeDialogOpen}>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className="flux-friend-request-action flux-friend-request-accept shrink-0"
                >
                    <UserPlus size={16} aria-hidden="true" /> Add friend
                </button>
            </DialogTrigger>
            <DialogContent
                className="h-[min(32rem,calc(100dvh-2rem))] gap-0 p-0"
                onOpenAutoFocus={(event) => {
                    // Первым фокусируем поиск, а не кнопку закрытия в header.
                    event.preventDefault();
                    searchInputRef.current?.focus();
                }}
            >
                <div className="shrink-0 border-b border-blue-100/70 p-4 dark:border-white/7">
                    <div className="flex items-center justify-between gap-3">
                        <DialogTitle>Add friend</DialogTitle>
                        <DialogClose asChild>
                            <button type="button" className="flux-icon-button" aria-label="Close add friend">
                                <X size={18} aria-hidden="true" />
                            </button>
                        </DialogClose>
                    </div>
                    <DialogDescription className="sr-only sm:not-sr-only">
                        Find someone by their username.
                    </DialogDescription>
                    <div className="flux-conversation-search mt-2.5 sm:mt-4">
                        <Search size={17} strokeWidth={1.8} aria-hidden="true" />
                        <input
                            ref={searchInputRef}
                            type="search"
                            className="text-base sm:text-sm"
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
                <FriendSearchResults
                    search={search}
                    requestSending={requestSending}
                    friendshipChangesByUserId={friendshipChangesByUserId}
                    onShowIncomingRequests={showIncomingRequests}
                />
            </DialogContent>
        </Dialog>
    );
};
