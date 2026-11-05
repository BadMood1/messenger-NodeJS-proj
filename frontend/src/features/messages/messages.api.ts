import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { Message, MessageDeletedEvent, MessagesPage, MessagesResponse } from "./messages.types";

type MessageResponse = {
    message: Message;
};

type GetMessagesOptions = {
    cursor?: string;
    cursorCreatedAt?: string;
    direction?: "older" | "newer";
    mode?: "latest" | "unread";
    limit?: number;
    signal?: AbortSignal;
};

// Получает id чата, функцию авторизованных запросов и параметры загрузки истории.
// Передаёт параметры в GET; без новых опций загружает историю как раньше, signal сохраняет отмену.
// Возвращает сообщения, курсоры в обе стороны, id первого непрочитанного и прежний hasMore.
export const getMessages = async (
    conversationId: string,
    authenticatedRequest: AuthenticatedRequest,
    { cursor, cursorCreatedAt, direction, mode, limit, signal }: GetMessagesOptions = {},
): Promise<MessagesPage> => {
    // формируем query параметры в url
    const query = new URLSearchParams();

    if (cursor) {
        query.set("cursor", cursor);
    }

    if (cursorCreatedAt) {
        query.set("cursorCreatedAt", cursorCreatedAt);
    }

    if (direction) {
        query.set("direction", direction);
    }

    if (mode) {
        query.set("mode", mode);
    }

    if (limit) {
        query.set("limit", String(limit)); // в бэкэнде от 1 до 50, по умолчанию 50
    }

    const queryString = query.toString();
    // Timeout относится к одной странице, а не ко всей многостраничной сверке после reconnect.
    return runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(
                `${API_URL}/conversations/${conversationId}/messages${queryString ? `?${queryString}` : ""}`,
                { signal: requestSignal },
            );
            if (!response.ok) throw await createApiRequestError(response, "Failed to load messages");
            const data = (await response.json()) as MessagesResponse;
            return {
                ...data,
                // nextCursor по-прежнему обозначает только продолжение вверх, не вниз.
                hasMore: data.nextCursor !== null,
            };
        },
        { signal },
    );
};

export const sendMessage = async (
    conversationId: string,
    content: string,
    authenticatedRequest: AuthenticatedRequest,
    replyToId?: string,
    clientMessageId?: string,
    previousClientMessageId?: string,
) => {
    const response = await authenticatedRequest(`${API_URL}/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, replyToId, clientMessageId, previousClientMessageId }),
    });

    if (!response.ok) throw await createApiRequestError(response, "Failed to send message");

    const data = (await response.json()) as MessageResponse;

    return data.message;
};

export const editMessage = async (
    messageId: string,
    content: string,
    authenticatedRequest: AuthenticatedRequest,
) => {
    const response = await authenticatedRequest(`${API_URL}/conversations/messages/${messageId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
    });

    if (!response.ok) throw await createApiRequestError(response, "Failed to edit message");

    const data = (await response.json()) as MessageResponse;

    return data.message;
};

// Получает id сообщения и функцию защищённых запросов.
// Выполняет DELETE и проверяет успешность ответа.
// Возвращает id удалённого сообщения, чат и актуальный preview для sidebar
export const deleteMessage = async (
    messageId: string,
    authenticatedRequest: AuthenticatedRequest,
): Promise<MessageDeletedEvent> => {
    const response = await authenticatedRequest(`${API_URL}/conversations/messages/${messageId}`, {
        method: "DELETE",
    });

    if (!response.ok) throw await createApiRequestError(response, "Failed to delete message");
    return (await response.json()) as MessageDeletedEvent;
};
