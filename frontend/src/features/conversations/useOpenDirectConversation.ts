import { useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { openDirectConversation } from "./conversations.api";
import type { Conversation } from "./conversations.types";

type ConversationOpeningError = {
    userId: string;
    message: string;
};

type UseOpenDirectConversationOptions = {
    isEnabled: boolean;
    conversations: Conversation[];
    authenticatedRequest: AuthenticatedRequest;
    onConversationReady: (conversation: Conversation) => void;
};

// Получает список диалогов, признак открытого окна, request и обработчик готового диалога.
// Открывает известный диалог сразу или выполняет POST, управляя ожиданием и отменой.
// Возвращает обработчики выбора/отмены, id ожидающего пользователя и ошибку для Retry.
export const useOpenDirectConversation = ({
    isEnabled,
    conversations,
    authenticatedRequest,
    onConversationReady,
}: UseOpenDirectConversationOptions) => {
    // для какой строки показывать loader
    const [openingUserId, setOpeningUserId] = useState<string | null>(null);
    const [openingError, setOpeningError] = useState<ConversationOpeningError | null>(null);
    // контроллер текущего POST
    const openingControllerRef = useRef<AbortController | null>(null);

    // Уход со страницы тоже отменяет POST, чтобы ответ не открыл чат после unmount.
    useEffect(() => () => openingControllerRef.current?.abort(), []);

    // Получает закрытие окна пользователем.
    // Сразу отменяет текущий POST и снимает блокировку запроса.
    // Сохраняет UI-снимок до конца анимации закрытия окна.
    const cancelOpeningConversation = () => {
        openingControllerRef.current?.abort();
        openingControllerRef.current = null;
    };

    // Получает новое открытие окна или изменение поискового ввода.
    // Отменяет прежнюю попытку и очищает её ожидание/ошибку.
    // Подготавливает окно к новому выбору пользователя.
    const resetConversationOpening = () => {
        cancelOpeningConversation();
        setOpeningUserId(null);
        setOpeningError(null);
    };

    // Получает id пользователя из результата поиска или кнопки Retry.
    // Находит готовый диалог в списке либо получает его через POST, защищаясь от повторных кликов.
    // Передаёт актуальный результат родителю; при ошибке сохраняет пользователя для повтора.
    const openConversationForUser = async (userId: string) => {
        if (!isEnabled || openingControllerRef.current) return;
        setOpeningError(null);

        const existingConversation = conversations.find((conversation) => conversation.user?.id === userId);
        if (existingConversation) {
            // Сразу передаём в финал. обработчик, который обновл. список, выбир. чат и закрыв. окно. POST не нужен
            onConversationReady(existingConversation);
            return;
        }

        // --- Если диалога в локальном списке нет: ---

        const controller = new AbortController();
        openingControllerRef.current = controller;
        setOpeningUserId(userId);
        try {
            const conversation = await openDirectConversation(userId, authenticatedRequest, {
                signal: controller.signal,
            });
            // Если окно закрыли, поздний ответ не добавляет диалог и не меняет selected.
            if (controller.signal.aborted) return;
            onConversationReady(conversation);
        } catch (error) {
            if (controller.signal.aborted) return;
            setOpeningError({
                userId,
                message: error instanceof Error ? error.message : "Failed to open conversation",
            });
            setOpeningUserId(null);
        } finally {
            // Старый finally не снимает блокировку нового POST, начатого после закрытия окна.
            if (openingControllerRef.current === controller) {
                openingControllerRef.current = null;
            }
            // Успешный выбор закрывает окно; loader сохраняем до конца анимации и сбросим при открытии.
        }
    };

    return {
        openingUserId,
        openingError,
        openConversationForUser,
        cancelOpeningConversation,
        resetConversationOpening,
    };
};
