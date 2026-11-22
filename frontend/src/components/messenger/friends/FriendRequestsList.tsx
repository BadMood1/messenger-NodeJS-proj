import { ArrowDownLeft, ArrowUpRight, LoaderCircle } from "lucide-react";
import { useState } from "react";

import type {
    FriendRequest,
    FriendRequestAction,
    FriendRequestDirection,
} from "../../../features/friends/friends.types";
import type { RequestRetryState } from "../../../lib/request-retry";
import { RequestRetryStatus } from "../RequestRetryStatus";
import { FriendRequestRow } from "./FriendRequestRow";

type FriendRequestsListProps = {
    direction: FriendRequestDirection;
    isActive: boolean;
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

// Получает направление, активность раздела, заявки и состояние их загрузки.
// Показывает участников и действия; блокирует кнопки на время POST/DELETE.
// Возвращает список с состояниями загрузки и ошибки и держит открытым одно меню.
export const FriendRequestsList = ({
    direction,
    isActive,
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
    const [openRequestMenuId, setOpenRequestMenuId] = useState<string | null>(null);

    // Меню находится в портале, поэтому при уходе в Chats закрываем его вместе с панелью.
    if (!isActive && openRequestMenuId !== null) setOpenRequestMenuId(null);

    // Получает id заявки и новое состояние её меню от Radix.
    // При открытии заменяет предыдущее меню, а при закрытии сверяет id.
    // Сохраняет id единственного открытого меню или null.
    const changeRequestMenuOpen = (requestId: string, isOpen: boolean) => {
        if (isOpen) {
            setOpenRequestMenuId(requestId);
            return;
        }
        setOpenRequestMenuId((current) => current === requestId ? null : current);
    };

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
                        {requests.map((request) => (
                            <FriendRequestRow
                                key={request.id}
                                request={request}
                                isIncoming={isIncoming}
                                actionsDisabled={!isActive || pendingAction !== null}
                                pendingAction={pendingAction?.requestId === request.id ? pendingAction.action : null}
                                actionError={actionError?.requestId === request.id ? actionError.message : null}
                                isMenuOpen={openRequestMenuId === request.id}
                                onMenuOpenChange={changeRequestMenuOpen}
                                onRequestAction={onRequestAction}
                            />
                        ))}
                    </ul>
                ))}
        </div>
    );
};
