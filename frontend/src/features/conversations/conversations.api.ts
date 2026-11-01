import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
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
    readState: ConversationReadState; // до какого сообщ. backend подтвердил прочтение
    peerReadState: ConversationReadState | null; // прочтение собеседника
    unreadCount: number;
    localRead?: LocalConversationRead; // до какого сообщ. я дошёл на экране
};

export type ConversationReadState = {
    conversationId: string;
    userId: string;
    lastReadMessageId: string | null;
    lastReadMessageCreatedAt: string | null;
};

// Только клиентские данные: увиденная граница и известное окно истории до подтверждения PATCH.
export type LocalConversationRead = {
    readState: ConversationReadState;
    messages: Array<Pick<ConversationLastMessage, "id" | "createdAt" | "senderId"> & { isDeleted?: boolean }>;
    latestLoadedMessage: ConversationLastMessage | null;
};

type ConversationsResponse = {
    conversations: Conversation[];
};

export type ConversationReadResult = {
    readState: ConversationReadState;
    unreadCount: number;
    lastMessage: ConversationLastMessage | null;
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
