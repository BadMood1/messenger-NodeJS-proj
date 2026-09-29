import { API_URL } from "../../lib/config";

export type ConversationUser = {
    id: string;
    name: string;
    username: string;
    image: string | null;
};

export type Conversation = {
    id: string;
    type: "DIRECT";
    createdAt: string;
    updatedAt: string;
    user: ConversationUser | null;
};

type ConversationsResponse = {
    conversations: Conversation[];
};

// Загружаем доступные текущему пользователю DIRECT-диалоги.
export const getConversations = async (accessToken: string) => {
    const response = await fetch(`${API_URL}/conversations`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
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

        throw new Error(message);
    }

    const data = (await response.json()) as ConversationsResponse;

    return data.conversations;
};
