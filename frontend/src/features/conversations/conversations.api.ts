import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { Conversation, ConversationReadResult, ConversationsResponse } from "./conversations.types";

type ConversationRequestOptions = {
    signal?: AbortSignal;
};

type OpenDirectConversationResponse = {
    conversation: Conversation;
};

// Получает функцию авторизованных запросов и сигнал отмены.
// Загружаем доступные текущему пользователю DIRECT-диалоги.
// Возвращает список с последними сообщениями или выбрасывает ошибку запроса.
export const getConversations = async (
    authenticatedRequest: AuthenticatedRequest,
    { signal }: ConversationRequestOptions = {},
) => {
    return runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(`${API_URL}/conversations`, {
                signal: requestSignal,
            });
            if (!response.ok) throw await createApiRequestError(response, "Failed to load conversations");
            const data = (await response.json()) as ConversationsResponse;
            return data.conversations;
        },
        { signal },
    );
};

// Получает id собеседника, функцию защищённых запросов и signal отмены.
// Выполняет POST; backend создаёт DIRECT-диалог или возвращает существующий для этой пары.
// Возвращает готовый Conversation с preview и прочтением в том же формате, что GET списка.
export const openDirectConversation = async (
    userId: string,
    authenticatedRequest: AuthenticatedRequest,
    { signal }: ConversationRequestOptions = {},
): Promise<Conversation> => {
    return runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(
                `${API_URL}/conversations/direct/${encodeURIComponent(userId)}`,
                { method: "POST", signal: requestSignal },
            );
            if (!response.ok) throw await createApiRequestError(response, "Failed to open conversation");
            const data = (await response.json()) as OpenDirectConversationResponse;
            return data.conversation;
        },
        { signal },
    );
};

// Получает id чата, id последнего прочитанного сообщения и функцию авторизованных запросов.
// Отправляет PATCH с messageId; signal позволяет отменить запрос.
// Возвращает границу, счётчик и последнее сообщение для прямого обновления sidebar.
export const markConversationRead = async (
    conversationId: string,
    messageId: string,
    authenticatedRequest: AuthenticatedRequest,
    { signal }: ConversationRequestOptions = {},
): Promise<ConversationReadResult> => {
    return runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(`${API_URL}/conversations/${conversationId}/read`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messageId }),
                signal: requestSignal,
            });
            if (!response.ok)
                throw await createApiRequestError(response, "Failed to mark conversation as read");
            return (await response.json()) as ConversationReadResult;
        },
        { signal, timeoutMs: 10_000 },
    );
};
