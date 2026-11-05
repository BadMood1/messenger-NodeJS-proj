import { MessageCircleMore } from "lucide-react";
import { useRef, useState, type RefObject } from "react";

import type { Conversation } from "../../../features/conversations/conversations.types";
import type { Message, ClientMessage } from "../../../features/messages/messages.types";
import type { RequestRetryState } from "../../../lib/request-retry";
import { ChatHeader } from "./ChatHeader";
import { ChatMessageHistory } from "./ChatMessageHistory";
import { ChatComposer } from "./ChatComposer";
import { MessageDeleteDialog } from "./MessageDeleteDialog";
import { useChatComposer } from "./useChatComposer";

type ChatPanelProps = {
    conversation: Conversation | null;
    messages: ClientMessage[];
    hasOlderMessages: boolean;
    messagesLoading: boolean;
    messagesError: string | null;
    initialRetry: RequestRetryState | null;
    historySyncRetry: RequestRetryState | null;
    paginationRetry: RequestRetryState | null;
    onRetryInitialMessages: () => void;
    historySyncError: string | null;
    onRetryHistorySync: () => void;
    isOffline: boolean;
    currentUserId: string | null;
    onSendMessage: (content: string, replyTo?: Message) => void;
    onRetryMessage: (messageId: string) => void;
    onEditMessage: (messageId: string, content: string) => Promise<void>;
    onDeleteMessage: (messageId: string) => Promise<void>;
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    onMessagesScroll: () => void;
    isScrollToLatestButtonVisible: boolean;
    isLoadingLatest: boolean;
    onScrollToLatest: () => void;
    isLoadingOlder: boolean;
    isLoadingNewer: boolean;
    olderMessagesError: string | null;
    newerMessagesError: string | null;
    firstUnreadMessageId: string | null;
    onRetryHistoryPage: () => void;
    onBack: () => void;
    isPeerTyping: boolean;
    isPeerOnline: boolean | null;
    peerLastSeenAt: string | null;
    onComposerTyping: (content: string) => void;
    onStopTyping: () => void;
};

// Получает выбранный диалог, историю и обработчики из MessengerPage.
// Соединяет header, историю, composer и подтверждение удаления; состояние ввода хранит в одном хуке.
// Возвращает текущий экран чата или empty state, сохраняя порядок обработки Escape.
export const ChatPanel = (props: ChatPanelProps) => {
    const { conversation } = props;
    const conversationUser = conversation?.user;
    const composer = useChatComposer({
        messagesLoading: props.messagesLoading,
        messagesError: props.messagesError,
        onSendMessage: props.onSendMessage,
        onEditMessage: props.onEditMessage,
        onStopTyping: props.onStopTyping,
    });
    const { replyingMessage, cancelReply } = composer;

    // ==================== DELETE ====================
    const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
    // Снимок сообщения сохраняем при закрытии, чтобы preview не прыгал во время exit-анимации.
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const deletingRef = useRef(false); // защита от дублей

    // Получает сообщение из меню Delete.
    // Сохраняет его снимок и открывает подтверждение удаления.
    // Сбрасывает ошибку предыдущей попытки DELETE.
    const confirmDelete = (message: Message) => {
        setDeletingMessage(message);
        setDeleteDialogOpen(true);
        setDeleteError(null);
    };

    // Использует выбранное сообщение и обработчик удаления из MessengerPage.
    // Выполняет DELETE один раз и при успехе отменяет связанный с сообщением Reply/Edit.
    // Закрывает диалог после успеха или сохраняет его с ошибкой для повтора.
    const handleDelete = async () => {
        if (!deleteDialogOpen || !deletingMessage || deletingRef.current) return;

        deletingRef.current = true;
        setIsDeleting(true);
        setDeleteError(null);

        try {
            await props.onDeleteMessage(deletingMessage.id);
            composer.cancelReplyOrEditForDeletedMessage(deletingMessage.id);
            setDeleteDialogOpen(false);
        } catch (requestError) {
            setDeleteError(requestError instanceof Error ? requestError.message : "Failed to delete message");
        } finally {
            deletingRef.current = false;
            setIsDeleting(false);
        }
    };

    // ==================== CHAT ====================
    if (!conversation || !conversationUser) {
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
        <section
            className="flux-chat-panel"
            onKeyDown={(event) => {
                // Escape сначала отменяет Reply, но меню и модалка обрабатывают его сами.
                if (
                    event.key === "Escape" &&
                    replyingMessage &&
                    !event.defaultPrevented &&
                    !(
                        event.target instanceof Element &&
                        event.target.closest('[role="menu"], [role="alertdialog"]')
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelReply();
                }
            }}
        >
            <ChatHeader
                conversationUser={conversationUser}
                isPeerTyping={props.isPeerTyping}
                isPeerOnline={props.isPeerOnline}
                peerLastSeenAt={props.peerLastSeenAt}
                onBack={props.onBack}
            />
            <ChatMessageHistory
                conversation={conversation}
                messages={props.messages}
                hasOlderMessages={props.hasOlderMessages}
                messagesLoading={props.messagesLoading}
                messagesError={props.messagesError}
                initialRetry={props.initialRetry}
                paginationRetry={props.paginationRetry}
                onRetryInitialMessages={props.onRetryInitialMessages}
                isOffline={props.isOffline}
                currentUserId={props.currentUserId}
                onRetryMessage={props.onRetryMessage}
                messagesContainerRef={props.messagesContainerRef}
                onMessagesScroll={props.onMessagesScroll}
                isScrollToLatestButtonVisible={props.isScrollToLatestButtonVisible}
                isLoadingLatest={props.isLoadingLatest}
                onScrollToLatest={props.onScrollToLatest}
                isLoadingOlder={props.isLoadingOlder}
                isLoadingNewer={props.isLoadingNewer}
                olderMessagesError={props.olderMessagesError}
                newerMessagesError={props.newerMessagesError}
                firstUnreadMessageId={props.firstUnreadMessageId}
                onRetryHistoryPage={props.onRetryHistoryPage}
                actionsDisabled={composer.isSubmitting || isDeleting}
                onEdit={composer.startEditing}
                onDelete={confirmDelete}
                onReply={composer.startReply}
            />
            <ChatComposer
                composer={composer}
                conversationName={conversationUser.name}
                messagesLoading={props.messagesLoading}
                messagesError={props.messagesError}
                isOffline={props.isOffline}
                historySyncRetry={props.historySyncRetry}
                historySyncError={props.historySyncError}
                onRetryHistorySync={props.onRetryHistorySync}
                onComposerTyping={props.onComposerTyping}
                onStopTyping={props.onStopTyping}
            />
            <MessageDeleteDialog
                deletingMessage={deletingMessage}
                deleteDialogOpen={deleteDialogOpen}
                isDeleting={isDeleting}
                deleteError={deleteError}
                deletingRef={deletingRef}
                onOpenChange={setDeleteDialogOpen}
                onConfirm={handleDelete}
                onRestoreFocus={composer.focusInput}
            />
        </section>
    );
};
