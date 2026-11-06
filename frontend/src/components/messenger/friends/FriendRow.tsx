import { Check, Copy, LoaderCircle, MoreHorizontal, UserMinus, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Friend } from "../../../features/friends/friends.types";
import { getInitials } from "../../../lib/get-initials";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../../ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu";

type FriendRowProps = {
    friend: Friend;
    isOpening: boolean;
    actionsDisabled: boolean;
    onOpenConversation: (userId: string) => Promise<void>;
    onRemoveFriend: (friend: Friend) => void;
};

// Получает компонент пункта Radix и обработчики двух действий.
// Собирает одинаковые пункты для ПКМ и кнопки троеточия.
// Возвращает меню без дублирования его содержимого в двух местах.
const FriendActionItems = ({ Item, onCopy, onRemove }: {
    Item: typeof ContextMenuItem;
    onCopy: () => void;
    onRemove: () => void;
}) => (
    <>
        <Item disabled><UserRound aria-hidden="true" /> Go to Profile</Item>
        <Item onSelect={onCopy}><Copy aria-hidden="true" /> Copy username</Item>
        <div role="separator" className="my-1 h-px bg-blue-100/80 dark:bg-white/8" />
        <Item onSelect={onRemove} className="text-rose-600 focus:bg-rose-50 dark:text-rose-300 dark:focus:bg-rose-400/10">
            <UserMinus aria-hidden="true" /> Remove friend
        </Item>
    </>
);

// Получает друга, состояние открытия чата и обработчики действий.
// По основной кнопке открывает DIRECT; ПКМ, удержание и троеточие показывают меню.
// Возвращает строку с одним дополнительным действием и коротким подтверждением копирования.
export const FriendRow = ({ friend, isOpening, actionsDisabled, onOpenConversation, onRemoveFriend }: FriendRowProps) => {
    const displayName = friend.name || friend.username;
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const actionAfterMenuRef = useRef<(() => void) | null>(null);
    useEffect(() => () => clearTimeout(feedbackTimerRef.current), []);

    // Получает выбор Copy username из любого меню строки.
    // Копирует @username и на короткое время показывает результат рядом с именем.
    // При отказе clipboard показывает ошибку вместо ложного подтверждения.
    const copyUsername = async () => {
        clearTimeout(feedbackTimerRef.current);
        try {
            await navigator.clipboard.writeText(`@${friend.username}`);
            setCopyFeedback("Copied");
        } catch {
            setCopyFeedback("Couldn't copy");
        }
        feedbackTimerRef.current = setTimeout(() => setCopyFeedback(null), 1600);
    };

    // Получает закрытие dropdown или context menu после выбора действия.
    // Если выбрано удаление, сначала завершает закрытие меню, затем открывает подтверждение.
    // Передаёт фокус модалке без конкуренции с восстановлением фокуса Radix menu.
    const finishMenuAction = (event: Event) => {
        if (!actionAfterMenuRef.current) return;
        event.preventDefault();
        const action = actionAfterMenuRef.current;
        actionAfterMenuRef.current = null;
        action();
    };

    const menuActions = {
        onCopy: () => void copyUsername(),
        onRemove: () => { actionAfterMenuRef.current = () => onRemoveFriend(friend); },
    };

    return (
        <ContextMenu onOpenChange={setIsMenuOpen}>
            <ContextMenuTrigger asChild disabled={actionsDisabled}>
                <li className="flux-friend-row">
                    <button type="button" className="flux-friend-open" disabled={actionsDisabled}
                        aria-label={`Open chat with @${friend.username}`} aria-busy={isOpening}
                        onClick={() => {
                            // Отпускание после touch-удержания не должно открыть ещё и переписку.
                            if (!isMenuOpen) void onOpenConversation(friend.id);
                        }}>
                        <span className="flux-conversation-avatar overflow-hidden" aria-hidden="true">
                            {friend.image ? <img src={friend.image} alt="" className="size-full object-cover" /> : getInitials(displayName)}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{displayName}</span>
                            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">@{friend.username}</span>
                        </span>
                        {isOpening && <LoaderCircle size={16} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    </button>
                    {copyFeedback && <span className="flux-friend-copy-feedback" role="status">
                        {copyFeedback === "Copied" && <Check size={13} aria-hidden="true" />}{copyFeedback}
                    </span>}
                    <DropdownMenu onOpenChange={setIsMenuOpen}>
                        <DropdownMenuTrigger asChild>
                            <button type="button" className="flux-icon-button flux-friend-more size-8 shrink-0" disabled={actionsDisabled}
                                aria-label={`Actions for @${friend.username}`}>
                                <MoreHorizontal size={18} aria-hidden="true" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="flux-popover-motion" align="end" onCloseAutoFocus={finishMenuAction}>
                            <FriendActionItems Item={DropdownMenuItem} {...menuActions} />
                        </DropdownMenuContent>
                    </DropdownMenu>
                </li>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={finishMenuAction}>
                <FriendActionItems Item={ContextMenuItem} {...menuActions} />
            </ContextMenuContent>
        </ContextMenu>
    );
};
