import { useRef, useState } from "react";

import type { Friend } from "../../../features/friends/friends.types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "../../ui/alert-dialog";

type FriendRemoveDialogProps = {
    friend: Friend | null;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onRemove: (userId: string) => Promise<void>;
    onRestoreFocus: () => void;
};

// Получает снимок друга, состояние открытия и обработчик удаления из списка.
// Подтверждает DELETE, блокирует повторное нажатие и сохраняет ошибку внутри модалки.
// Закрывается после успеха; при ошибке оставляет возможность повторить действие.
export const FriendRemoveDialog = ({ friend, isOpen, onOpenChange, onRemove, onRestoreFocus }: FriendRemoveDialogProps) => {
    const [isRemoving, setIsRemoving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const removingRef = useRef(false);

    // Получает подтверждение удаления выбранного друга.
    // Дожидается DELETE, затем закрывает модалку; при ошибке сохраняет её открытой.
    // Снимает блокировку после завершения единственного выполняющегося запроса.
    const confirmRemoval = async () => {
        if (!friend || removingRef.current) return;
        removingRef.current = true;
        setIsRemoving(true);
        setError(null);
        try {
            await onRemove(friend.id);
            onOpenChange(false);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Failed to remove friend");
        } finally {
            removingRef.current = false;
            setIsRemoving(false);
        }
    };

    return (
        <AlertDialog open={isOpen} onOpenChange={(open) => { if (!removingRef.current) onOpenChange(open); }}>
            <AlertDialogContent
                onOpenAutoFocus={() => setError(null)}
                onOutsideClick={() => { if (!removingRef.current) onOpenChange(false); }}
                onEscapeKeyDown={(event) => { if (removingRef.current) event.preventDefault(); }}
                onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
                <AlertDialogTitle>Remove {friend?.name || friend?.username}?</AlertDialogTitle>
                <AlertDialogDescription>Your conversation and messages will stay available.</AlertDialogDescription>
                {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
                <div className="flex justify-end gap-2">
                    <AlertDialogCancel disabled={isRemoving}>Cancel</AlertDialogCancel>
                    <AlertDialogAction disabled={isRemoving} onClick={(event) => {
                        // Не закрываем модалку стандартным Action: сначала ждём результат DELETE.
                        event.preventDefault();
                        void confirmRemoval();
                    }}>{isRemoving ? "Removing…" : "Remove friend"}</AlertDialogAction>
                </div>
            </AlertDialogContent>
        </AlertDialog>
    );
};
