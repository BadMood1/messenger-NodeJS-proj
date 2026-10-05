import { CircleAlert, CheckCheck, Clock3, CornerUpLeft, Pencil, RotateCcw, SquareCheck, Trash2 } from "lucide-react";
import { useRef } from "react";

import type { Message, ClientMessage } from "../../features/messages/messages.api";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../ui/context-menu";

type MessageBubbleProps = {
    message: ClientMessage;
    isOwnMessage: boolean;
    actionsDisabled: boolean;
    onEdit: (message: Message) => void;
    onDelete: (message: Message) => void;
    onReply: (message: Message) => void;
    onRetry: (messageId: string) => void;
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
    onRetry,
}: MessageBubbleProps) => {
    const actionSelectedRef = useRef<(() => void) | null>(null);

    return (
        <ContextMenu>
            {/* Modal-режим Radix блокирует скролл фона, пока меню открыто. */}
            {/* Правый клик обрабатывает Radix, задержку touch-удержания задаёт наш Trigger. */}
            {/* Temp id нельзя отправлять в backend для Reply/Edit/Delete. */}
            <ContextMenuTrigger asChild disabled={actionsDisabled || message.localStatus === "sending"}>
                <div
                    tabIndex={0}
                    aria-label="Message actions"
                    data-message-id={message.id}
                    className={`flux-message-placeholder focus-visible:outline-2 focus-visible:outline-blue-400 dark:focus-visible:outline-cyan-400 ${
                        isOwnMessage
                            ? "flux-message-placeholder-outgoing ml-auto"
                            : "flux-message-placeholder-incoming"
                    } ${message.localStatus === "failed" ? "flux-message-failed" : ""}`}
                >
                    {message.replyTo && (
                        <blockquote className="flux-reply-preview mb-2">
                            <span className="block truncate font-semibold">
                                {message.replyTo.sender.name || message.replyTo.sender.username}
                            </span>
                            <span className="line-clamp-2 wrap-anywhere opacity-80">
                                {message.replyTo.content}
                            </span>
                        </blockquote>
                    )}
                    <span className="flux-message-text">{message.content}</span>
                    <span className="flux-message-meta-spacer" aria-hidden="true" />
                    <span className="flux-message-meta">
                        <time>{formatMessageTime(message.createdAt)}</time>
                        {isOwnMessage &&
                            (message.localStatus ? (
                                message.localStatus === "sending" ? (
                                    <Clock3 size={14} className="opacity-60" aria-label="Sending" />
                                ) : (
                                    <CircleAlert size={14} className="text-rose-500 dark:text-rose-400" aria-label="Failed to send" />
                                )
                            ) : (
                                <CheckCheck size={16} strokeWidth={2} aria-label="Read" />
                            ))}
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
                {message.localStatus === "failed" && (
                    <ContextMenuItem onSelect={() => {
                        actionSelectedRef.current = () => onRetry(message.id);
                    }}>
                        <RotateCcw aria-hidden="true" /> Retry
                    </ContextMenuItem>
                )}
                {!message.localStatus && (
                    <ContextMenuItem
                        onSelect={() => {
                            actionSelectedRef.current = () => onReply(message);
                        }}
                    >
                        <CornerUpLeft aria-hidden="true" /> Reply
                    </ContextMenuItem>
                )}
                {isOwnMessage && (
                    <>
                        {!message.localStatus && (
                            <ContextMenuItem
                                onSelect={() => {
                                    actionSelectedRef.current = () => onEdit(message);
                                }}
                            >
                                <Pencil aria-hidden="true" /> Edit
                            </ContextMenuItem>
                        )}
                        <ContextMenuItem
                            disabled={message.localStatus === "sending"}
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
                <ContextMenuItem disabled>
                    <SquareCheck aria-hidden="true" /> Select
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
};
