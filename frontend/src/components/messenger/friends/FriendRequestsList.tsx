import { ArrowDownLeft, ArrowUpRight, Check, LoaderCircle, X } from "lucide-react";

import type {
    FriendRequest,
    FriendRequestAction,
    FriendRequestDirection,
} from "../../../features/friends/friends.types";
import { getInitials } from "../../../lib/get-initials";
import type { RequestRetryState } from "../../../lib/request-retry";
import { RequestRetryStatus } from "../RequestRetryStatus";

type FriendRequestsListProps = {
    direction: FriendRequestDirection;
    requests: FriendRequest[];
    hasLoaded: boolean;
    isLoading: boolean;
    error: string | null;
    requestRetry: RequestRetryState | null;
    retryRequests: () => void;
    pendingAction: { requestId: string; action: FriendRequestAction } | null;
    actionError: { requestId: string; message: string } | null;
    onRequestAction: (request: FriendRequest, action: FriendRequestAction) => Promise<void>;
};

const requestDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

// Получает направление, реальные заявки и состояние их загрузки.
// Показывает участников и действия; блокирует кнопки на время POST/DELETE.
// Возвращает список с loading/error/empty и ошибкой действия у соответствующей заявки.
export const FriendRequestsList = ({
    direction,
    requests,
    hasLoaded,
    isLoading,
    error,
    requestRetry,
    retryRequests,
    pendingAction,
    actionError,
    onRequestAction,
}: FriendRequestsListProps) => {
    const isIncoming = direction === "incoming";
    const DirectionIcon = isIncoming ? ArrowDownLeft : ArrowUpRight;

    return (
        <div className="flux-friends-list-view" aria-busy={isLoading}>
            {(requestRetry || error) && (
                <div className={hasLoaded ? "mb-3" : "flex min-h-48 items-center justify-center"}>
                    <RequestRetryStatus retry={requestRetry} error={error} onRetry={retryRequests} />
                </div>
            )}
            {!hasLoaded && !requestRetry && !error && (
                <div className="flux-conversation-state min-h-48 gap-2" role="status">
                    <LoaderCircle
                        size={18}
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                    />
                    Loading {direction} requests…
                </div>
            )}
            {hasLoaded &&
                (requests.length === 0 ? (
                    <div
                        className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 text-center"
                        role="status"
                    >
                        <DirectionIcon
                            size={30}
                            strokeWidth={1.5}
                            className="text-blue-300 dark:text-slate-600"
                            aria-hidden="true"
                        />
                        <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                No {direction} requests
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {isIncoming
                                    ? "New friend requests will appear here."
                                    : "Requests you send will appear here."}
                            </p>
                        </div>
                    </div>
                ) : (
                    <ul
                        className="mx-auto max-w-3xl space-y-2"
                        aria-label={`${isIncoming ? "Incoming" : "Outgoing"} friend requests`}
                    >
                        {requests.map((request) => {
                            const { id, createdAt, user } = request;
                            const isSubmittingRequest = pendingAction?.requestId === id;
                            return (
                                <li
                                    key={id}
                                    className="flux-friend-row flex-wrap gap-3 px-3 py-3.5"
                                    aria-busy={isSubmittingRequest}
                                >
                                    <span
                                        className="flux-conversation-avatar shrink-0 overflow-hidden"
                                        aria-hidden="true"
                                    >
                                        {user.image ? (
                                            <img src={user.image} alt="" className="size-full object-cover" />
                                        ) : (
                                            getInitials(user.name || user.username)
                                        )}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                                            {user.name || user.username}
                                        </p>
                                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                                            @{user.username}
                                        </p>
                                    </div>
                                    <time
                                        dateTime={createdAt}
                                        className="shrink-0 whitespace-nowrap text-[11px] text-slate-400 dark:text-slate-500"
                                    >
                                        {requestDateFormatter.format(new Date(createdAt))}
                                    </time>
                                    <div className="flex w-full shrink-0 justify-end gap-2 sm:w-auto">
                                        {isIncoming && (
                                            <button
                                                type="button"
                                                className="flux-friend-request-action flux-friend-request-accept"
                                                disabled={pendingAction !== null}
                                                aria-label={`Accept request from @${user.username}`}
                                                onClick={() => void onRequestAction(request, "accept")}
                                            >
                                                {isSubmittingRequest && pendingAction.action === "accept" ? (
                                                    <LoaderCircle
                                                        size={14}
                                                        className="animate-spin motion-reduce:animate-none"
                                                        aria-hidden="true"
                                                    />
                                                ) : (
                                                    <Check size={14} aria-hidden="true" />
                                                )}
                                                Accept
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="flux-friend-request-action"
                                            disabled={pendingAction !== null}
                                            aria-label={`${isIncoming ? "Decline request from" : "Cancel request to"} @${user.username}`}
                                            onClick={() => void onRequestAction(request, "delete")}
                                        >
                                            {isSubmittingRequest && pendingAction.action === "delete" ? (
                                                <LoaderCircle
                                                    size={14}
                                                    className="animate-spin motion-reduce:animate-none"
                                                    aria-hidden="true"
                                                />
                                            ) : (
                                                <X size={14} aria-hidden="true" />
                                            )}
                                            {isIncoming ? "Decline" : "Cancel"}
                                        </button>
                                    </div>
                                    {actionError?.requestId === id && (
                                        <p
                                            role="alert"
                                            className="w-full text-xs text-rose-600 dark:text-rose-300"
                                        >
                                            {actionError.message}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ))}
        </div>
    );
};
