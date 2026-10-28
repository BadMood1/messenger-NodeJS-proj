import { API_URL } from "../../lib/config";
import { ApiRequestError } from "../../lib/api-request-error";
import type { AuthenticatedRequest } from "../auth/authenticated-request";

export type ConversationUser = {
    id: string;
    name: string;
    username: string;
    image: string | null;
};

export type ConversationLastMessage = {
    id: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    senderId: string;
};

export type Conversation = {
    id: string;
    type: "DIRECT";
    createdAt: string;
    updatedAt: string;
    user: ConversationUser | null;
    lastMessage: ConversationLastMessage | null;
    readState: ConversationReadState;
};

export type ConversationReadState = {
    conversationId: string;
    userId: string;
    lastReadMessageId: string | null;
    lastReadMessageCreatedAt: string | null;
};

type ConversationsResponse = {
    conversations: Conversation[];
};

type MarkConversationReadResponse = {
    readState: ConversationReadState;
};

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
    const response = await authenticatedRequest(`${API_URL}/conversations`, {
        signal, // нужен для отмены запроса при смене токена или уходе со страницы
    });

    if (!response.ok) {
        let message = "Failed to load conversations";

        try {
            // пробуем прочитать поле error из JSON, который вернул backend
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
        } catch {
            // Если backend вернул не JSON, оставляем понятную ошибку по умолчанию
        }

        throw new ApiRequestError(message, response.status);
    }

    const data = (await response.json()) as ConversationsResponse;

    return data.conversations;
};

// Получает id чата, id последнего прочитанного сообщения и функцию авторизованных запросов.
// Отправляет PATCH с messageId; signal позволяет отменить запрос.
// Возвращает сохранённую backend границу прочтения или выбрасывает ошибку запроса.
export const markConversationRead = async (
    conversationId: string,
    messageId: string,
    authenticatedRequest: AuthenticatedRequest,
    { signal }: MarkConversationReadOptions = {},
): Promise<ConversationReadState> => {
    const response = await authenticatedRequest(`${API_URL}/conversations/${conversationId}/read`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId }),
        signal,
    });

    if (!response.ok) {
        let message = "Failed to mark conversation as read";

        try {
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
        } catch {
            // Если ответ не JSON, оставляем текст ошибки по умолчанию.
        }

        throw new ApiRequestError(message, response.status);
    }

    const data = (await response.json()) as MarkConversationReadResponse;

    return data.readState;
};
