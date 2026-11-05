import { useCallback } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { deleteMessage as deleteMessageRequest, editMessage as editMessageRequest } from "./messages.api";
import type { MessageDeletedEvent, MessageSender } from "./messages.types";
import { useConversationMessageState } from "./state/useConversationMessageState";
import { useMessageHistory } from "./history/useMessageHistory";
import { useMessageSending } from "./sending/useMessageSending";
import { useMessageScrollPosition } from "./scroll/useMessageScrollPosition";

type UseConversationMessagesOptions = {
    conversationId: string | null;
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
    currentUser: MessageSender | null;
};

// Получает выбранный чат, пользователя и функцию авторизованных запросов.
// Соединяет общий state, загрузку истории, scroll и optimistic-отправку.
// Возвращает прежний интерфейс сообщений для MessengerPage и realtime.
export const useConversationMessages = ({
    conversationId,
    enabled,
    authenticatedRequest,
    currentUser,
}: UseConversationMessagesOptions) => {
    // ==================== ОБЩИЙ STATE И ИСТОРИЯ ====================
    const messageState = useConversationMessageState({ conversationId, enabled });
    const {
        conversationIdRef,
        historyVersionRef,
        handleMessageUpdated,
        handleMessageDeleted: applyMessageDeletion,
    } = messageState;
    const scroll = useMessageScrollPosition(messageState.messages);
    const history = useMessageHistory({ conversationId, enabled, authenticatedRequest, messageState, scroll });
    const { forgetDeferredMessage, requestLatestWindowForSend, ...historyView } = history;

    // ==================== SEND / RETRY ====================
    const { sendMessage, retryMessage, discardFailedMessage } = useMessageSending({
        enabled,
        authenticatedRequest,
        currentUser,
        messageState,
        scrollToBottomAfterUpdate: scroll.scrollToBottomAfterUpdate,
        requestLatestWindowForSend,
    });

    // Получает ответ DELETE или socket-событие удаления.
    // Убирает запись из буфера истории и применяет удаление к общему state.
    // Повторное событие безопасно; сообщения другого чата обработчики пропускают.
    const handleMessageDeleted = useCallback(
        (deletion: Pick<MessageDeletedEvent, "id" | "conversationId">) => {
            forgetDeferredMessage(deletion);
            applyMessageDeletion(deletion);
        },
        [forgetDeferredMessage, applyMessageDeletion],
    );

    // ==================== EDIT / DELETE ====================
    // Получает server id сообщения и новый текст.
    // Выполняет PATCH и передаёт ответ в тот же обработчик, что принимает socket-правки.
    // Обновляет список только для актуальной версии открытого чата.
    const editMessage = async (messageId: string, content: string) => {
        const currentConversationId = conversationIdRef.current;
        const historyVersion = historyVersionRef.current;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        const message = await editMessageRequest(messageId, content, authenticatedRequest);

        // PATCH старого чата не должен менять сообщения в уже открытом новом чате.
        if (
            conversationIdRef.current === currentConversationId &&
            historyVersionRef.current === historyVersion
        ) {
            // Ответ PATCH и socket-событие используют один обработчик, независимо от порядка доставки.
            handleMessageUpdated(message);
        }
    };

    // Получает id сообщения из подтверждения удаления.
    // Убирает локальное failed либо выполняет DELETE и применяет серверный результат.
    // Возвращает результат DELETE для обновления preview диалога в MessengerPage.
    const deleteMessage = async (messageId: string) => {
        const currentConversationId = conversationIdRef.current;

        // Failed bubble существует только локально: temp id не отправляем в DELETE API.
        if (discardFailedMessage(messageId)) return;

        if (!currentConversationId || !enabled) {
            throw new Error("No conversation selected");
        }

        const deletion = await deleteMessageRequest(messageId, authenticatedRequest);

        // DELETE старого чата не должен менять сообщения в уже открытом новом чате.
        if (conversationIdRef.current === currentConversationId) {
            handleMessageDeleted(deletion);
        }
        return deletion;
    };

    return {
        ...historyView,
        sendMessage,
        retryMessage,
        editMessage,
        deleteMessage,
        handleMessageUpdated,
        handleMessageDeleted,
    };
};
