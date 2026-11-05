import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { ConversationReadResult, ConversationsResponse } from "./conversations.types";

type GetConversationsOptions = {
    signal?: AbortSignal;
};

type MarkConversationReadOptions = {
    signal?: AbortSignal;
};

// Получает функцию авторизованных запросов и сигнал отмены.
// Загружаем доступные текущему пользователю DIRECT-диалоги.
// Возвращает список с последними сообщениями или выбрасывает ошибку запроса.
export const getConversations = async (
    authenticatedRequest: AuthenticatedRequest,
    { signal }: GetConversationsOptions = {},
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

// Получает id чата, id последнего прочитанного сообщения и функцию авторизованных запросов.
// Отправляет PATCH с messageId; signal позволяет отменить запрос.
// Возвращает границу, счётчик и последнее сообщение для прямого обновления sidebar.
export const markConversationRead = async (
    conversationId: string,
    messageId: string,
    authenticatedRequest: AuthenticatedRequest,
    { signal }: MarkConversationReadOptions = {},
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
