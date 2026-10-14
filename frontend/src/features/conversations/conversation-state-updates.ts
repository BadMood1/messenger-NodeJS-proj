import type { Message, MessageDeletedEvent } from "../messages/messages.api";
import type { Conversation } from "./conversations.api";

export type ConversationMessageEvent =
    | { type: "message"; message: Message }
    | { type: "deleted"; message: MessageDeletedEvent };

// ------- СОРТИРОВКА ДИАЛОГОВ -------
// Получает список диалогов.
// Сортирует по дате последнего сообщения, а пустые чаты — по дате создания.
// Возвращает новый список от более новых диалогов к старым.
export const sortConversationsByLastMessage = (conversations: Conversation[]): Conversation[] =>
    [...conversations].sort((firstConversation, secondConversation) => {
        const firstDate = firstConversation.lastMessage?.createdAt ?? firstConversation.createdAt;
        const secondDate = secondConversation.lastMessage?.createdAt ?? secondConversation.createdAt;
        const activityDifference = Date.parse(secondDate) - Date.parse(firstDate);
        if (activityDifference !== 0) return activityDifference;

        // Если даты последних сообщений равны — сравниваем даты создания чатов, затем их id.
        const creationDifference =
            Date.parse(secondConversation.createdAt) - Date.parse(firstConversation.createdAt);
        if (creationDifference !== 0) return creationDifference;
        return secondConversation.id.localeCompare(firstConversation.id);
    });

// ------- ОБНОВЛЕНИЕ ПОСЛЕДНЕГО СООБЩЕНИЯ -------
// Получает список диалогов и созданное или изменённое сообщение.
// Обновляет preview нужного чата, если сообщение не старее текущего последнего.
// Возвращает список с актуальным текстом и порядком диалогов.
export const updateConversationLastMessage = (
    conversations: Conversation[],
    message: Message,
): Conversation[] => {
    const updatedConversations = conversations.map((conversation) => {
        if (conversation.id !== message.conversationId) return conversation;
        const lastMessage = conversation.lastMessage;

        // Если пришло более старое сообщение — последнее сообщение чата не меняем.
        if (lastMessage) {
            const createdAtDifference = Date.parse(message.createdAt) - Date.parse(lastMessage.createdAt);
            if (createdAtDifference < 0) return conversation;
            // Если даты двух сообщений равны — последним выбираем сообщение с большим id.
            if (createdAtDifference === 0 && message.id < lastMessage.id) return conversation;
            // Если пришла старая версия того же сообщения — оставляем свежий текст.
            if (
                message.id === lastMessage.id &&
                Date.parse(message.updatedAt) < Date.parse(lastMessage.updatedAt)
            ) {
                return conversation;
            }
        }

        return {
            ...conversation,
            lastMessage: {
                id: message.id,
                content: message.content,
                createdAt: message.createdAt,
                updatedAt: message.updatedAt,
                senderId: message.senderId,
            },
        };
    });
    return sortConversationsByLastMessage(updatedConversations);
};

// ------- УДАЛЕНИЕ PREVIEW -------
// Получает список диалогов и id удалённого сообщения с id его чата.
// Убирает preview, если удалили именно последнее сообщение этого диалога.
// Возвращает список без удалённого текста; предыдущее сообщение загрузит REST.
export const clearDeletedConversationPreview = (
    conversations: Conversation[],
    message: MessageDeletedEvent,
): Conversation[] => {
    const updatedConversations = conversations.map((conversation) =>
        conversation.id === message.conversationId && conversation.lastMessage?.id === message.id
            ? { ...conversation, lastMessage: null }
            : conversation,
    );
    return sortConversationsByLastMessage(updatedConversations);
};

// ------- ПРИМЕНЕНИЕ СОБЫТИЯ -------
// Получает список диалогов и одно сохранённое событие сообщения.
// Применяет новое сообщение, правку или удаление к preview нужного чата.
// Возвращает обновлённый список для sidebar.
export const applyConversationMessageEvent = (
    conversations: Conversation[],
    event: ConversationMessageEvent,
): Conversation[] => {
    if (event.type === "deleted") {
        return clearDeletedConversationPreview(conversations, event.message);
    }
    return updateConversationLastMessage(conversations, event.message);
};
