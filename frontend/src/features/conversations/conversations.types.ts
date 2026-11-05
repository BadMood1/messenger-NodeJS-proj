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

export type ConversationsResponse = {
    conversations: Conversation[];
};

export type ConversationReadResult = {
    readState: ConversationReadState;
    unreadCount: number;
    lastMessage: ConversationLastMessage | null;
};
