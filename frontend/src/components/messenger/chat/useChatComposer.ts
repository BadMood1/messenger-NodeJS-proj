import { useRef, useState, type FormEvent } from "react";

import type { Message } from "../../../features/messages/messages.types";

type UseChatComposerOptions = {
    messagesLoading: boolean;
    messagesError: string | null;
    onSendMessage: (content: string, replyTo?: Message) => void;
    onEditMessage: (messageId: string, content: string) => Promise<void>;
    onStopTyping: () => void;
};

// Получает обработчики отправки/Edit и состояние загрузки истории.
// Управляет текстом, черновиком, режимами Reply/Edit и фокусом одного composer.
// Возвращает его значения и обработчики для поля ввода и меню сообщений.
export const useChatComposer = ({
    messagesLoading,
    messagesError,
    onSendMessage,
    onEditMessage,
    onStopTyping,
}: UseChatComposerOptions) => {
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

    // Вызывается после закрытия диалога удаления.
    // Ставит фокус в существующий input composer.
    // Текст и режим ввода не изменяет.
    const focusInput = () => composerInputRef.current?.focus();

    // ==================== EDIT ====================
    // Edit
    // Получает сообщение из меню Edit.
    // Сохраняет черновик и подставляет текст сообщения в composer, отменяя Reply.
    // Обновляет режим редактирования и переводит фокус в input.
    const startEditing = (message: Message) => {
        if (submittingRef.current) return;
        onStopTyping(); // Edit не сообщает собеседнику о наборе нового сообщения

        // Сохраняем незавершённый черновик, чтобы вернуть его после Save/Cancel.
        if (!editingMessage) draftRef.current = content;
        // Edit и Reply — разные режимы одного composer, не совмещаем их.
        setReplyingMessage(null);
        setEditingMessage(message);
        setContent(message.content);
        setComposerError(null);
        composerInputRef.current?.focus();
    };

    // Вызывается по Cancel/Escape или при сохранении неизменённого текста.
    // Завершает Edit и возвращает черновик, если PATCH сейчас не выполняется.
    // Убирает ошибку composer и возвращает фокус в input.
    const cancelEditing = () => {
        if (submittingRef.current) return;

        setEditingMessage(null);
        setContent(draftRef.current);
        setComposerError(null);
        composerInputRef.current?.focus();
    };

    // ==================== REPLY ====================
    // Получает сообщение из меню Reply.
    // Выбирает его для ответа; если был активен Edit, возвращает обычный черновик.
    // Обновляет preview ответа и переводит фокус в input.
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

    // Вызывается по X или Escape при активном Reply.
    // Снимает выбранное сообщение, сохраняя набранный текст.
    // Убирает preview ответа и возвращает фокус в input.
    const cancelReply = () => {
        if (submittingRef.current) return;
        setReplyingMessage(null);
        composerInputRef.current?.focus();
    };

    // Получает id успешно удалённого сообщения.
    // Если оно редактировалось — отменяет Edit; если было выбрано для ответа — отменяет Reply.
    // Согласует режим composer с удалением сообщения из истории.
    const cancelReplyOrEditForDeletedMessage = (messageId: string) => {
        if (editingMessage?.id === messageId) cancelEditing();
        if (replyingMessage?.id === messageId) setReplyingMessage(null);
    };

    // ==================== SUBMIT ====================
    // Получает submit формы и очищает пробелы по краям текста.
    // Вызывает Edit либо optimistic Send; неизменённый Edit завершает локально.
    // После успеха обновляет текст и режим, после ошибки сохраняет ввод и показывает её.
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
                onStopTyping();
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

    return {
        content,
        setContent,
        editingMessage,
        replyingMessage,
        isSubmitting,
        composerError,
        composerInputRef,
        focusInput,
        startEditing,
        cancelEditing,
        startReply,
        cancelReply,
        cancelReplyOrEditForDeletedMessage,
        handleSubmit,
    };
};
