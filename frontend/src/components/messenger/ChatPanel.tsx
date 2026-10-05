import {
    ArrowLeft,
    Check,
    MessageCircleMore,
    MoreHorizontal,
    Phone,
    Plus,
    Search,
    SendHorizontal,
    Smile,
    Video,
    X,
} from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";

import { MessageBubble } from "./MessageBubble";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
} from "../ui/alert-dialog";
import type { Conversation } from "../../features/conversations/conversations.api";
import type { Message, ClientMessage } from "../../features/messages/messages.api";

type ChatPanelProps = {
    conversation: Conversation | null;
    messages: ClientMessage[];
    messagesLoading: boolean;
    messagesError: string | null;
    currentUserId: string | null;
    onSendMessage: (content: string, replyTo?: Message) => void;
    onRetryMessage: (messageId: string) => void;
    onEditMessage: (messageId: string, content: string) => Promise<void>;
    onDeleteMessage: (messageId: string) => Promise<void>;
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    onMessagesScroll: () => void;
    isLoadingOlder: boolean;
    olderMessagesError: string | null;
    onBack: () => void;
};

const getInitials = (name: string) => {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("");
};

export const ChatPanel = ({
    conversation,
    messages,
    messagesLoading,
    messagesError,
    currentUserId,
    onSendMessage,
    onRetryMessage,
    onEditMessage,
    onDeleteMessage,
    messagesContainerRef,
    onMessagesScroll,
    isLoadingOlder,
    olderMessagesError,
    onBack,
}: ChatPanelProps) => {
    const conversationUser = conversation?.user;

    const [content, setContent] = useState("");
    const [editingMessage, setEditingMessage] = useState<Message | null>(null);
    const [replyingMessage, setReplyingMessage] = useState<Message | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // ошибка отправки или редактирования
    const [composerError, setComposerError] = useState<string | null>(null);
    // Позволяет поставить фокус в input
    const composerInputRef = useRef<HTMLInputElement | null>(null);
    // текст что был в input до начала редактирования
    const draftRef = useRef("");
    const submittingRef = useRef(false); // защита от повторного запроса

    const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
    // Снимок сообщения сохраняем при закрытии, чтобы preview не прыгал во время exit-анимации.
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deletingRef = useRef(false); // защита от дублей

    // Edit
    const startEditing = (message: Message) => {
        if (submittingRef.current) return;

        // Сохраняем незавершённый черновик, чтобы вернуть его после Save/Cancel.
        if (!editingMessage) draftRef.current = content;
        // Edit и Reply — разные режимы одного composer, не совмещаем их.
        setReplyingMessage(null);
        setEditingMessage(message);
        setContent(message.content);
        setComposerError(null);
        composerInputRef.current?.focus();
    };

    const cancelEditing = () => {
        if (submittingRef.current) return;

        setEditingMessage(null);
        setContent(draftRef.current);
        setComposerError(null);
        composerInputRef.current?.focus();
    };

    const confirmDelete = (message: Message) => {
        setDeletingMessage(message);
        setDeleteDialogOpen(true);
        setDeleteError(null);
    };

    const startReply = (message: Message) => {
        if (submittingRef.current) return;
        if (editingMessage) {
            setEditingMessage(null);
            setContent(draftRef.current);
        }
        setReplyingMessage(message);
        setComposerError(null);
        composerInputRef.current?.focus();
    };

    const cancelReply = () => {
        if (submittingRef.current) return;
        setReplyingMessage(null);
        composerInputRef.current?.focus();
    };

    const handleDelete = async () => {
        if (!deleteDialogOpen || !deletingMessage || deletingRef.current) return;

        deletingRef.current = true;
        setIsDeleting(true);
        setDeleteError(null);

        try {
            await onDeleteMessage(deletingMessage.id);
            if (editingMessage?.id === deletingMessage.id) cancelEditing();
            if (replyingMessage?.id === deletingMessage.id) setReplyingMessage(null);
            setDeleteDialogOpen(false);
        } catch (requestError) {
            setDeleteError(requestError instanceof Error ? requestError.message : "Failed to delete message");
        } finally {
            deletingRef.current = false;
            setIsDeleting(false);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const trimmedContent = content.trim();

        if (!trimmedContent || submittingRef.current || messagesLoading || messagesError) {
            return;
        }

        // Неизменённый текст просто завершает Edit, без лишнего PATCH.
        if (editingMessage && trimmedContent === editingMessage.content.trim()) {
            cancelEditing();
            return;
        }

        submittingRef.current = true;
        setIsSubmitting(true);
        setComposerError(null);

        try {
            if (editingMessage) {
                await onEditMessage(editingMessage.id, trimmedContent);
                setEditingMessage(null);
                setContent(draftRef.current);
            } else {
                onSendMessage(trimmedContent, replyingMessage ?? undefined);
                setContent("");
                // Текст и reply уже сохранены в optimistic bubble, включая случай ошибки POST.
                setReplyingMessage(null);
            }
        } catch (requestError) {
            setComposerError(requestError instanceof Error ? requestError.message : "Failed to save message");
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
            composerInputRef.current?.focus();
        }
    };

    if (!conversationUser) {
        return (
            <section className="flux-chat-panel">
                <div className="flux-chat-empty">
                    <MessageCircleMore size={28} strokeWidth={1.6} aria-hidden="true" />
                    <div>
                        <h2>Select a conversation to start chatting</h2>
                        <p>Choose a conversation from the list to see the chat.</p>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="flux-chat-panel" onKeyDown={(event) => {
            // Escape сначала отменяет Reply, но меню и модалка обрабатывают его сами.
            if (event.key === "Escape" && replyingMessage && !event.defaultPrevented &&
                !(event.target instanceof Element && event.target.closest('[role="menu"], [role="alertdialog"]'))) {
                event.preventDefault();
                event.stopPropagation();
                cancelReply();
            }
        }}>
            <header className="flux-chat-header">
                <div className="flex items-center gap-3 max-lg:min-w-0 max-lg:gap-2">
                    <button type="button" className="flux-icon-button lg:hidden" aria-label="Back to conversations" onClick={onBack}>
                        <ArrowLeft size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <div className="flux-chat-avatar overflow-hidden">
                        {conversationUser.image ? (
                            <img src={conversationUser.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                            getInitials(conversationUser.name) || "?"
                        )}
                    </div>
                    <div className="max-lg:min-w-0">
                        <h2 className="text-base font-semibold leading-5 text-slate-900 dark:text-slate-50 max-lg:truncate">
                            {conversationUser.name}
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 max-lg:truncate">
                            @{conversationUser.username}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-1 max-lg:shrink-0">
                    <button type="button" className="flux-icon-button max-lg:hidden" aria-label="Search chat">
                        <Search size={19} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-icon-button" aria-label="Call">
                        <Phone size={19} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-icon-button" aria-label="Video call">
                        <Video size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button type="button" className="flux-icon-button" aria-label="More options">
                        <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                </div>
            </header>

            <div ref={messagesContainerRef} className="flux-chat-messages" onScroll={onMessagesScroll}>
                {messagesLoading ? (
                    <div className="flux-chat-content-state" role="status">
                        Loading messages...
                    </div>
                ) : messagesError ? (
                    <div className="flux-chat-content-state text-rose-600 dark:text-rose-300" role="alert">
                        {messagesError}
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flux-chat-content-state">No messages yet</div>
                ) : (
                    <div className="flux-message-stack">
                        {isLoadingOlder && <div className="flux-load-older">Loading older messages...</div>}
                        {olderMessagesError && (
                            <div className="flux-load-older-error" role="alert">
                                {olderMessagesError}
                            </div>
                        )}
                        {messages.map((message) => (
                            <MessageBubble
                                key={message.id}
                                message={message}
                                isOwnMessage={message.senderId === currentUserId}
                                actionsDisabled={isSubmitting || isDeleting}
                                onEdit={startEditing}
                                onDelete={confirmDelete}
                                onReply={startReply}
                                onRetry={onRetryMessage}
                            />
                        ))}
                    </div>
                )}
            </div>

            <footer className="shrink-0 border-t border-slate-200/60 p-3.5 dark:border-white/8 lg:p-4">
                {replyingMessage && (
                    <div className="mb-2 flex items-center gap-3" aria-label="Reply preview">
                        <blockquote className="flux-reply-preview min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                                {replyingMessage.sender.name || replyingMessage.sender.username}
                            </span>
                            <span className="block truncate opacity-80">{replyingMessage.content}</span>
                        </blockquote>
                        <button type="button" className="flux-icon-button" aria-label="Cancel reply"
                            disabled={isSubmitting} onClick={cancelReply}>
                            <X size={16} aria-hidden="true" />
                        </button>
                    </div>
                )}
                {editingMessage && (
                    <div className="mb-2 flex items-center justify-between gap-3 px-2 text-sm text-blue-600 dark:text-cyan-300">
                        <span className="min-w-0 truncate">Editing message</span>
                        <button
                            type="button"
                            className="flex items-center gap-1 text-xs"
                            onClick={cancelEditing}
                            disabled={isSubmitting}
                        >
                            <X size={14} aria-hidden="true" /> Cancel
                        </button>
                    </div>
                )}
                <form className="flux-composer" onSubmit={handleSubmit}>
                    <button type="button" className="flux-composer-action" aria-label="Add attachment">
                        <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <input
                        ref={composerInputRef}
                        type="text"
                        className="flux-composer-input"
                        placeholder={`Message ${conversationUser.name}...`}
                        aria-label={editingMessage ? "Edit message" : `Message ${conversationUser.name}`}
                        value={content}
                        onChange={(event) => setContent(event.target.value)}
                        readOnly={isSubmitting}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && editingMessage) {
                                event.preventDefault();
                                event.stopPropagation();
                                cancelEditing();
                            }
                        }}
                    />
                    <button type="button" className="flux-composer-emoji" aria-label="Choose emoji">
                        <Smile size={18} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                    <button
                        type="submit"
                        className="flux-composer-send cursor-pointer"
                        aria-label={editingMessage ? "Save message" : "Send message"}
                        disabled={isSubmitting || messagesLoading || Boolean(messagesError) || !content.trim()}
                    >
                        {editingMessage ? (
                            <Check size={18} strokeWidth={2} aria-hidden="true" />
                        ) : (
                            <SendHorizontal size={17} strokeWidth={1.8} aria-hidden="true" />
                        )}
                    </button>
                </form>
                {composerError && (
                    <p className="mt-2 text-center text-xs text-rose-600 dark:text-rose-300" role="alert">
                        {composerError}
                    </p>
                )}
            </footer>

            <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                    if (!deletingRef.current) setDeleteDialogOpen(open);
                }}
            >
                <AlertDialogContent
                    onOutsideClick={() => {
                        // Во время DELETE не скрываем диалог с возможной ошибкой.
                        if (!deletingRef.current) setDeleteDialogOpen(false);
                    }}
                    onEscapeKeyDown={(event) => {
                        if (deletingRef.current) event.preventDefault();
                    }}
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        composerInputRef.current?.focus();
                    }}
                >
                    <AlertDialogTitle>Delete this message?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                    <blockquote className="line-clamp-3 wrap-anywhere rounded-xl bg-blue-50 px-3 py-2 text-sm text-slate-600 dark:bg-white/5 dark:text-slate-300">
                        {deletingMessage?.content}
                    </blockquote>
                    {deleteError && (
                        <p className="text-sm text-rose-600 dark:text-rose-300" role="alert">
                            {deleteError}
                        </p>
                    )}
                    <div className="flex justify-end gap-2">
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isDeleting}
                            onClick={(event) => {
                                // Закрываем диалог только после успешного DELETE, чтобы показать ошибку внутри.
                                event.preventDefault();
                                void handleDelete();
                            }}
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
};
