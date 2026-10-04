import { CheckCheck, CornerUpLeft, Pencil, SquareCheck, Trash2 } from "lucide-react";
import { useRef } from "react";

import type { Message } from "../../features/messages/messages.api";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from "../ui/context-menu";

type MessageBubbleProps = {
    message: Message;
    isOwnMessage: boolean;
    actionsDisabled: boolean;
    onEdit: (message: Message) => void;
    onDelete: (message: Message) => void;
    onReply: (message: Message) => void;
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

// "Пузырь" для отдельного сообщения
export const MessageBubble = ({
    message,
    isOwnMessage,
    actionsDisabled,
    onEdit,
    onDelete,
    onReply,
}: MessageBubbleProps) => {
    const actionSelectedRef = useRef<(() => void) | null>(null);

    return (
        <ContextMenu>
            {/* Modal-режим Radix блокирует скролл фона, пока меню открыто. */}
            {/* Правый клик обрабатывает Radix, задержку touch-удержания задаёт наш Trigger. */}
            <ContextMenuTrigger asChild disabled={actionsDisabled}>
                <div
                    tabIndex={0}
                    aria-label="Message actions"
                    className={`flux-message-placeholder focus-visible:outline-2 focus-visible:outline-blue-400 dark:focus-visible:outline-cyan-400 ${
                        isOwnMessage
                            ? "flux-message-placeholder-outgoing ml-auto"
                            : "flux-message-placeholder-incoming"
                    }`}
                >
                    {message.replyTo && (
                        <blockquote className="flux-reply-preview mb-2">
                            <span className="block truncate font-semibold">
                                {message.replyTo.sender.name || message.replyTo.sender.username}
                            </span>
                            <span className="line-clamp-2 wrap-anywhere opacity-80">{message.replyTo.content}</span>
                        </blockquote>
                    )}
                    <span className="flux-message-text">{message.content}</span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>{formatMessageTime(message.createdAt)}</time>
                        {isOwnMessage && <CheckCheck size={16} strokeWidth={2} aria-label="Read" />}
                    </span>
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent
                onCloseAutoFocus={(event) => {
                    // После Edit/Delete фокус переходит в composer или диалог, а не назад в меню.
                    // Reply тоже оставляет фокус в composer.
                    if (actionSelectedRef.current) {
                        event.preventDefault();
                        // Сначала закрываем modal menu, затем передаём фокус в composer/диалог.
                        actionSelectedRef.current();
                        actionSelectedRef.current = null;
                    }
                }}
            >
                <ContextMenuItem onSelect={() => {
                    actionSelectedRef.current = () => onReply(message);
                }}>
                    <CornerUpLeft aria-hidden="true" /> Reply
                </ContextMenuItem>
                {isOwnMessage && (
                    <>
                        <ContextMenuItem
                            onSelect={() => {
                                actionSelectedRef.current = () => onEdit(message);
                            }}
                        >
                            <Pencil aria-hidden="true" /> Edit
                        </ContextMenuItem>
                        <ContextMenuItem
                            className="text-rose-600 focus:bg-rose-50 dark:text-rose-300 dark:focus:bg-rose-400/10"
                            onSelect={() => {
                                actionSelectedRef.current = () => onDelete(message);
                            }}
                        >
                            <Trash2 aria-hidden="true" /> Delete
                        </ContextMenuItem>
                    </>
                )}
                {/* Select пока только обозначает будущее действие. */}
                <ContextMenuItem disabled><SquareCheck aria-hidden="true" /> Select</ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};
