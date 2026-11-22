import { Check, LoaderCircle, UserRound, X } from "lucide-react";

import type { FriendRequest, FriendRequestAction } from "../../../features/friends/friends.types";
import { getInitials } from "../../../lib/get-initials";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../ui/context-menu";

type FriendRequestRowProps = {
    request: FriendRequest;
    isIncoming: boolean;
    actionsDisabled: boolean;
    pendingAction: FriendRequestAction | null;
    actionError: string | null;
    isMenuOpen: boolean;
    onMenuOpenChange: (requestId: string, isOpen: boolean) => void;
    onRequestAction: (request: FriendRequest, action: FriendRequestAction) => Promise<void>;
};

const requestDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

// Получает заявку, её направление, состояние действий и обработчики меню.
// Показывает карточку с кнопками и открывает те же действия по ПКМ или удержанию.
// Возвращает строку списка с индикатором отправки и ошибкой действия.
export const FriendRequestRow = ({
    request,
    isIncoming,
    actionsDisabled,
    pendingAction,
    actionError,
    isMenuOpen,
    onMenuOpenChange,
    onRequestAction,
}: FriendRequestRowProps) => {
    const { id, createdAt, user } = request;

    // Получает действие с видимой кнопки карточки.
    // Игнорирует клик при открытом меню, в том числе при отпускании после удержания.
    // Передаёт обычный клик общему обработчику заявки.
    const runCardAction = (action: FriendRequestAction) => {
        if (!isMenuOpen) void onRequestAction(request, action);
    };

    return (
        <ContextMenu modal={false} open={isMenuOpen} onOpenChange={(isOpen) => onMenuOpenChange(id, isOpen)}>
            <ContextMenuTrigger asChild disabled={actionsDisabled}>
                <li
                    className="flux-friend-row flex-wrap gap-3 px-3 py-3.5"
                    aria-busy={pendingAction !== null}
                >
                    <span className="flux-conversation-avatar shrink-0 overflow-hidden" aria-hidden="true">
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
                    <div
                        className={
                            isIncoming
                                ? "grid w-full shrink-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:justify-end"
                                : "shrink-0"
                        }
                    >
                        {isIncoming && (
                            <button
                                type="button"
                                className="flux-friend-request-action flux-friend-request-accept"
                                disabled={actionsDisabled}
                                aria-label={`Accept request from @${user.username}`}
                                onClick={() => runCardAction("accept")}
                            >
                                {pendingAction === "accept" ? (
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
                            className={
                                isIncoming
                                    ? "flux-friend-request-action"
                                    : "flux-icon-button max-sm:size-11 enabled:cursor-pointer disabled:opacity-50 motion-reduce:transition-none"
                            }
                            disabled={actionsDisabled}
                            aria-label={`${isIncoming ? "Decline request from" : "Cancel request to"} @${user.username}`}
                            onClick={() => runCardAction("delete")}
                        >
                            {pendingAction === "delete" ? (
                                <LoaderCircle
                                    size={14}
                                    className="animate-spin motion-reduce:animate-none"
                                    aria-hidden="true"
                                />
                            ) : (
                                <X size={14} aria-hidden="true" />
                            )}
                            {isIncoming && "Decline"}
                        </button>
                    </div>
                    {actionError !== null && (
                        <p role="alert" className="w-full text-xs text-rose-600 dark:text-rose-300">
                            {actionError}
                        </p>
                    )}
                </li>
            </ContextMenuTrigger>
            <ContextMenuContent className="data-[state=closed]:animate-none">
                <ContextMenuItem disabled>
                    <UserRound aria-hidden="true" /> Go to Profile
                </ContextMenuItem>
                <div role="separator" className="my-1 h-px bg-blue-100/80 dark:bg-white/8" />
                {isIncoming && (
                    <ContextMenuItem
                        disabled={actionsDisabled}
                        className="text-blue-600 focus:bg-blue-50 dark:text-cyan-300 dark:focus:bg-blue-400/12"
                        onSelect={() => void onRequestAction(request, "accept")}
                    >
                        <Check aria-hidden="true" /> Accept
                    </ContextMenuItem>
                )}
                <ContextMenuItem
                    disabled={actionsDisabled}
                    className={
                        isIncoming
                            ? "text-rose-600 focus:bg-rose-50 dark:text-rose-300 dark:focus:bg-rose-400/10"
                            : "text-slate-600 dark:text-slate-300"
                    }
                    onSelect={() => void onRequestAction(request, "delete")}
                >
                    <X aria-hidden="true" /> {isIncoming ? "Decline" : "Cancel request"}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};
