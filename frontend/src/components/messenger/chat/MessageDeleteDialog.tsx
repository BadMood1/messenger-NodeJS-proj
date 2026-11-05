import type { RefObject } from "react";

import type { Message } from "../../../features/messages/messages.types";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogTitle,
} from "../../ui/alert-dialog";

type MessageDeleteDialogProps = {
    deletingMessage: Message | null;
    deleteDialogOpen: boolean;
    isDeleting: boolean;
    deleteError: string | null;
    deletingRef: RefObject<boolean>;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => Promise<void>;
    onRestoreFocus: () => void;
};

// Получает снимок удаляемого сообщения, состояние DELETE и обработчики диалога.
// Показывает подтверждение с preview и ошибкой; во время DELETE блокирует закрытие.
// Возвращает модалку и после её закрытия восстанавливает фокус composer.
export const MessageDeleteDialog = ({
    deletingMessage,
    deleteDialogOpen,
    isDeleting,
    deleteError,
    deletingRef,
    onOpenChange,
    onConfirm,
    onRestoreFocus,
}: MessageDeleteDialogProps) => (
    <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
            if (!deletingRef.current) onOpenChange(open);
        }}
    >
        <AlertDialogContent
            onOutsideClick={() => {
                // Во время DELETE не скрываем диалог с возможной ошибкой.
                if (!deletingRef.current) onOpenChange(false);
            }}
            onEscapeKeyDown={(event) => {
                if (deletingRef.current) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
                event.preventDefault();
                onRestoreFocus();
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
                        void onConfirm();
                    }}
                >
                    {isDeleting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
            </div>
        </AlertDialogContent>
    </AlertDialog>
);
