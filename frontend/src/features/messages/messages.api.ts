import { API_URL } from "../../lib/config";

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
};

type MessagesResponse = {
    messages: Message[];
    nextCursor: string | null;
};

// Загружаем первую страницу истории: backend сам применяет limit по умолчанию.
export const getMessages = async (conversationId: string, accessToken: string, signal?: AbortSignal) => {
    const response = await fetch(`${API_URL}/conversations/${conversationId}/messages`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
        signal,
    });

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

    return data.messages;
};
