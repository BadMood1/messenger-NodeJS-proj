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
    createdAt: string;
    updatedAt: string;
    senderId: string;
    conversationId: string;
    sender: MessageSender;
    replyToId: string | null;
    replyTo: {
        id: string;
        content: string;
        sender: Pick<MessageSender, "id" | "name" | "username">;
    } | null;
};

type MessagesResponse = {
    messages: Message[];
    nextCursor: string | null;
};

export type MessagesPage = {
    messages: Message[];
    nextCursor: string | null;
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
    limit?: number;
    signal?: AbortSignal;
};

// Без cursor загружаем первую страницу, с cursor — более старые сообщения.
export const getMessages = async (
    conversationId: string,
    authenticatedRequest: AuthenticatedRequest,
    { cursor, limit, signal }: GetMessagesOptions = {},
): Promise<MessagesPage> => {
    // формируем query параметры в url
    const query = new URLSearchParams();

    if (cursor) {
        query.set("cursor", cursor);
    }

    if (limit) {
        query.set("limit", String(limit)); // в бэкэнде лимит от 30 до 50
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
        // Backend возвращает nextCursor только если у истории есть следующая страница.
        hasMore: data.nextCursor !== null,
    };
};

export const sendMessage = async (
    conversationId: string,
    content: string,
    authenticatedRequest: AuthenticatedRequest,
    replyToId?: string,
) => {
    const response = await authenticatedRequest(`${API_URL}/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, replyToId }),
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

export const deleteMessage = async (
    messageId: string,
    authenticatedRequest: AuthenticatedRequest,
) => {
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
