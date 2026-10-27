import { API_URL } from "../../lib/config";
import type { AuthenticatedRequest } from "../auth/authenticated-request";

export type MessageSender = {
    id: string;
    name: string;
    username: string;
    image: string | null;
};

export type Message = {
    id: string;
    content: string;
    clientMessageId: string | null; // у старых сообщений null; новые связаны с frontend по этому UUID
    createdAt: string;
    updatedAt: string;
    senderId: string;
    conversationId: string;
    sender: MessageSender;
    replyToId: string | null;
    replyTo: {
        id: string;
        content: string;
        updatedAt: string; // Дата правки цитируемого сообщения, не самого ответа.
        sender: Pick<MessageSender, "id" | "name" | "username">;
    } | null;
};

export type MessageDeletedEvent = Pick<Message, "id" | "conversationId">;

// id и дата вместе задают позицию, даже если сообщение уже удалено.
export type MessageHistoryCursor = {
    id: string;
    createdAt: string;
};

type MessagesResponse = {
    messages: Message[];
    nextCursor: string | null;
    olderCursor: MessageHistoryCursor | null;
    newerCursor: MessageHistoryCursor | null;
    firstUnreadMessageId: string | null;
};

// Только клиентский статус: backend и cursor работают с обычными Message.
export type ClientMessage = Message & {
    localStatus?: "sending" | "failed";
    sendError?: string;
};

export type MessagesPage = MessagesResponse & {
    // Пока существующие хуки используют nextCursor/hasMore для загрузки вверх.
    hasMore: boolean;
};

type SendMessageResponse = {
    message: Message;
};

type EditMessageResponse = {
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
        query.set("limit", String(limit)); // в бэкэнде от 1 до 50, по умолчанию 30
    }

    const queryString = query.toString();
    const response = await authenticatedRequest(
        `${API_URL}/conversations/${conversationId}/messages${queryString ? `?${queryString}` : ""}`,
        {
            signal,
        },
    );

    if (!response.ok) {
        let message = "Failed to load messages";

        try {
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
        } catch {
            // Если backend вернул не JSON, оставляем понятную ошибку по умолчанию.
        }

        throw new Error(message);
    }

    const data = (await response.json()) as MessagesResponse;

    return {
        messages: data.messages,
        nextCursor: data.nextCursor,
        olderCursor: data.olderCursor,
        newerCursor: data.newerCursor,
        firstUnreadMessageId: data.firstUnreadMessageId,
        // nextCursor по-прежнему обозначает только продолжение вверх, не вниз.
        hasMore: data.nextCursor !== null,
    };
};

export const sendMessage = async (
    conversationId: string,
    content: string,
    authenticatedRequest: AuthenticatedRequest,
    replyToId?: string,
    clientMessageId?: string,
) => {
    const response = await authenticatedRequest(`${API_URL}/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, replyToId, clientMessageId }),
    });

    if (!response.ok) {
        let message = "Failed to send message";

        try {
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
        } catch {
            // Если backend вернул не JSON, оставляем понятную ошибку по умолчанию.
        }

        throw new Error(message);
    }

    const data = (await response.json()) as SendMessageResponse;

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

    if (!response.ok) {
        let message = "Failed to edit message";

        try {
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
        } catch {
            // Если backend вернул не JSON, оставляем понятную ошибку по умолчанию.
        }

        throw new Error(message);
    }

    const data = (await response.json()) as EditMessageResponse;

    return data.message;
};

export const deleteMessage = async (messageId: string, authenticatedRequest: AuthenticatedRequest) => {
    const response = await authenticatedRequest(`${API_URL}/conversations/messages/${messageId}`, {
        method: "DELETE",
    });

    if (!response.ok) {
        let message = "Failed to delete message";

        try {
            const body = (await response.json()) as { error?: string };
            message = body.error ?? message;
        } catch {
            // Если backend вернул не JSON, оставляем понятную ошибку по умолчанию.
        }

        throw new Error(message);
    }
};
