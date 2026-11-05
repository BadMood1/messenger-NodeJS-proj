import { Check, Plus, SendHorizontal, Smile, X } from "lucide-react";

import type { RequestRetryState } from "../../../lib/request-retry";
import type { useChatComposer } from "./useChatComposer";
import { RequestRetryStatus } from "../RequestRetryStatus";

type ChatComposerProps = {
    composer: ReturnType<typeof useChatComposer>;
    conversationName: string;
    messagesLoading: boolean;
    messagesError: string | null;
    isOffline: boolean;
    historySyncRetry: RequestRetryState | null;
    historySyncError: string | null;
    onRetryHistorySync: () => void;
    onComposerTyping: (content: string) => void;
    onStopTyping: () => void;
};

// Получает состояние composer, имя собеседника и обработчики typing/Retry.
// Показывает Reply/Edit preview и связывает input с единым useChatComposer.
// Возвращает footer с формой и ошибками сохранения или сверки истории.
export const ChatComposer = ({
    composer,
    conversationName,
    messagesLoading,
    messagesError,
    isOffline,
    historySyncRetry,
    historySyncError,
    onRetryHistorySync,
    onComposerTyping,
    onStopTyping,
}: ChatComposerProps) => {
    const {
        content,
        setContent,
        editingMessage,
        replyingMessage,
        isSubmitting,
        composerError,
        composerInputRef,
        cancelEditing,
        cancelReply,
        handleSubmit,
    } = composer;

    return (
        <footer className="shrink-0 border-t border-slate-200/60 p-3.5 dark:border-white/8 lg:p-4">
            {!isOffline && (historySyncRetry || historySyncError) && (
                <div className="mb-2">
                    <RequestRetryStatus
                        retry={historySyncRetry}
                        error={historySyncError}
                        onRetry={onRetryHistorySync}
                    />
                </div>
            )}
            {replyingMessage && (
                <div className="mb-2 flex items-center gap-3" aria-label="Reply preview">
                    <blockquote className="flux-reply-preview min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                            {replyingMessage.sender.name || replyingMessage.sender.username}
                        </span>
                        <span className="block truncate opacity-80">{replyingMessage.content}</span>
                    </blockquote>
                    <button
                        type="button"
                        className="flux-icon-button"
                        aria-label="Cancel reply"
                        disabled={isSubmitting}
                        onClick={cancelReply}
                    >
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
                    placeholder={`Message ${conversationName}...`}
                    aria-label={editingMessage ? "Edit message" : `Message ${conversationName}`}
                    value={content}
                    onChange={(event) => {
                        const nextContent = event.target.value;
                        setContent(nextContent);
                        if (!editingMessage) onComposerTyping(nextContent);
                    }}
                    onBlur={onStopTyping}
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
    );
};
