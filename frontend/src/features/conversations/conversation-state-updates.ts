import type { Message, MessageDeletedEvent } from "../messages/messages.types";
import type { Conversation } from "./conversations.types";

export type ConversationMessageEvent =
    | { type: "created" | "updated"; message: Message }
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

// Получает сообщение и последнее известное сообщение диалога.
// Сравнивает дату создания; если даты равны — сравнивает id.
// Возвращает true, если сообщение идёт позже или диалог пока пуст.
export const isMessageNewerThanLastMessage = (
    message: Pick<Message, "id" | "createdAt">,
    lastMessage: Conversation["lastMessage"],
) => {
    if (!lastMessage) return true;
    const dateDifference = Date.parse(message.createdAt) - Date.parse(lastMessage.createdAt);
    if (dateDifference !== 0) return dateDifference > 0;
    // Если даты двух сообщений равны — последним выбираем сообщение с большим id.
    return message.id > lastMessage.id;
};

// ------- ОБНОВЛЕНИЕ PREVIEW И СЧЁТЧИКА -------
// Получает список диалогов, сообщение и тип события: создание или правка.
// Обновляет preview и сразу учитывает новое чужое сообщение после границы прочтения.
// Возвращает список с согласованными preview, unreadCount и порядком диалогов.
export const updateConversationPreviewAndUnreadCount = (
    conversations: Conversation[],
    message: Message,
    eventType: "created" | "updated",
): Conversation[] => {
    const updatedConversations = conversations.map((conversation) => {
        if (conversation.id !== message.conversationId) return conversation;

        const oldLastMessage = conversation.lastMessage; // preview до применения пришедшего события

        // Если пришло более старое сообщение — последнее сообщение чата не меняем.
        if (oldLastMessage) {
            if (message.id !== oldLastMessage.id && !isMessageNewerThanLastMessage(message, oldLastMessage)) {
                return conversation;
            }
            // Если пришла старая версия того же сообщения — оставляем свежий текст.
            if (
                message.id === oldLastMessage.id &&
                Date.parse(message.updatedAt) < Date.parse(oldLastMessage.updatedAt)
            ) {
                return conversation;
            }
        }

        // ---- ОПРЕДЕЛЯЕМ ЯВЛЯЕТСЯ ЛИ СООБЩ. НЕПРОЧИТАННЫМ ----

        // Сравниваем сообщение с подтверждённой границей прочтения этого пользователя.
        const readState = conversation.readState;
        // null - сохранённой границы ещё нет; > 0 значит message позже границы; < 0 - раньше
        const readDateDifference =
            readState.lastReadMessageCreatedAt === null
                ? null
                : Date.parse(message.createdAt) - Date.parse(readState.lastReadMessageCreatedAt);
        // Своё сообщение и сообщение до подтверждённой границы не считаем непрочитанным.
        const isUnreadMessage =
            message.senderId !== readState.userId && // чужое
            (readDateDifference === null || // находится после подтвержд. границы или границы ещё нет
                readDateDifference > 0 ||
                (readDateDifference === 0 && // даты совпали, провер. id
                    readState.lastReadMessageId !== null &&
                    message.id > readState.lastReadMessageId));
        // Edit и повтор текущего preview не увеличивают число.
        // Если preview удалён, а непрочитанные остались, точное число перечитает REST.
        const shouldIncreaseUnreadCount =
            eventType === "created" &&
            message.id !== oldLastMessage?.id &&
            // preview отсутствует, а непрочитанные есть
            (oldLastMessage !== null || conversation.unreadCount === 0) &&
            isUnreadMessage;

        return {
            ...conversation,
            unreadCount: shouldIncreaseUnreadCount ? conversation.unreadCount + 1 : conversation.unreadCount,
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

// ------- ЗАМЕНА PREVIEW ПОСЛЕ УДАЛЕНИЯ -------
// Получает список, результат удаления и известные удалённые id.
// Заменяет удалённый preview готовым lastMessage; более новое сообщение оставляет на месте.
// Возвращает список, отсортированный сразу по дате действующего preview.
export const updateConversationPreviewAfterDeletion = (
    conversations: Conversation[],
    deletion: MessageDeletedEvent,
    deletedMessageIds: ReadonlySet<string>,
): Conversation[] => {
    // Если сообщение для замены тоже уже удалено, ждём актуальный GET вместо его восстановления.
    if (deletion.lastMessage && deletedMessageIds.has(deletion.lastMessage.id)) return conversations;
    const updatedConversations = conversations.map((conversation) =>
        conversation.id === deletion.conversationId && conversation.lastMessage?.id === deletion.id
            ? { ...conversation, lastMessage: deletion.lastMessage }
            : conversation,
    );
    return sortConversationsByLastMessage(updatedConversations);
};

// ------- ПРИМЕНЕНИЕ СОБЫТИЯ -------
// Получает список диалогов, одно событие сообщения и известные удалённые id.
// Применяет создание, правку или удаление к preview; создание также обновляет счётчик.
// Возвращает обновлённый список для sidebar.
export const applyConversationMessageEvent = (
    conversations: Conversation[],
    event: ConversationMessageEvent,
    deletedMessageIds: ReadonlySet<string>,
): Conversation[] => {
    if (event.type === "deleted") {
        return updateConversationPreviewAfterDeletion(conversations, event.message, deletedMessageIds);
    }
    return updateConversationPreviewAndUnreadCount(conversations, event.message, event.type);
};
