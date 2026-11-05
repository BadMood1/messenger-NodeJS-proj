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

export type MessageDeletedEvent = Pick<Message, "id" | "conversationId"> & {
    lastMessage: Pick<Message, "id" | "content" | "createdAt" | "updatedAt" | "senderId"> | null;
};

// id и дата вместе задают позицию, даже если сообщение уже удалено.
export type MessageHistoryCursor = {
    id: string;
    createdAt: string;
};

export type MessagesResponse = {
    messages: Message[];
    nextCursor: string | null;
    olderCursor: MessageHistoryCursor | null;
    newerCursor: MessageHistoryCursor | null;
    firstUnreadMessageId: string | null;
};

// Только клиентские данные: backend и cursor работают с обычными Message.
export type ClientMessage = Message & {
    localStatus?: "sending" | "failed";
    sendError?: string;
    // Временная позиция optimistic-серии; после её завершения подтверждённая история сортируется по createdAt/id.
    localDisplayOrder?: number;
    // Только для POST: предыдущая ещё выполняющаяся отправка этого чата. (После неё сохр. сообщ.)
    previousClientMessageId?: string;
};

export type MessagesPage = MessagesResponse & {
    // Пока существующие хуки используют nextCursor/hasMore для загрузки вверх.
    hasMore: boolean;
};
