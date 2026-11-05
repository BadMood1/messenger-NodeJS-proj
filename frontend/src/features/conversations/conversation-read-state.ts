import type { Conversation, ConversationReadResult, ConversationReadState } from "./conversations.types";
import { isMessageNewerThanLastMessage, sortConversationsByLastMessage } from "./conversation-state-updates";

// Получает пришедшую и уже сохранённую границы прочтения.
// Сравнивает дату, а при совпадении — id сообщения.
// Возвращает true только для продвижения вперёд; повторы и старые границы пропускает.
export const isReadPositionNewer = (incoming: ConversationReadState, saved: ConversationReadState | null) => {
    if (incoming.lastReadMessageCreatedAt === null) return false;
    if (!saved || saved.lastReadMessageCreatedAt === null) return true;
    const dateDifference =
        Date.parse(incoming.lastReadMessageCreatedAt) - Date.parse(saved.lastReadMessageCreatedAt);
    if (dateDifference !== 0) return dateDifference > 0;
    return (
        incoming.lastReadMessageId !== null &&
        saved.lastReadMessageId !== null &&
        incoming.lastReadMessageId > saved.lastReadMessageId
    );
};

// Получает сообщение и границу прочтения.
// Сравнивает дату и id; при отсутствии границы считает сообщение более поздним.
// Возвращает true, если сообщение ещё находится после границы.
export const isMessageAfterReadState = (
    message: Pick<NonNullable<Conversation["lastMessage"]>, "id" | "createdAt">,
    readState: ConversationReadState,
) => {
    if (readState.lastReadMessageCreatedAt === null) return true;
    const dateDifference = Date.parse(message.createdAt) - Date.parse(readState.lastReadMessageCreatedAt);
    if (dateDifference !== 0) return dateDifference > 0;
    return readState.lastReadMessageId !== null && message.id > readState.lastReadMessageId;
};

// Получает список диалогов, результат PATCH/socket и известные удалённые id.
// Применяет новую границу и согласованный счётчик, сохраняя более свежие локальные сообщения.
// Возвращает список и признак редкого случая, когда число нужно уточнить через GET.
export const applyConversationReadResult = (
    conversations: Conversation[],
    result: ConversationReadResult,
    deletedMessageIds: ReadonlySet<string>,
): { conversations: Conversation[]; needsReload: boolean } => {
    let conversationFound = false; // нашли ли диалог к которому результат
    let hasChanges = false; // заменили ли данные какого-то диалога
    let needsReload = false; // нужно ли reload через GET
    const updatedConversations = conversations.map((conversation) => {
        if (conversation.id !== result.readState.conversationId) return conversation;
        conversationFound = true;
        // Результат относится только к пользователю, чьё прочтение хранится в этом диалоге.
        if (conversation.readState.userId !== result.readState.userId) return conversation;
        if (!isReadPositionNewer(result.readState, conversation.readState)) return conversation;

        // проверяем не устарел ли серверный снимок относит. известных нам сообщений
        const oldLastMessage = conversation.lastMessage; // превью до результата
        // в браузере уже известно более позднее last message, чем в пришедшем результате
        const hasNewerLocalMessage =
            oldLastMessage !== null && isMessageNewerThanLastMessage(oldLastMessage, result.lastMessage);
        // сервер прислал preview сообщения, которое frontend уже знает как удалённое
        const snapshotMessageWasDeleted =
            result.lastMessage !== null && deletedMessageIds.has(result.lastMessage.id);
        // среди сообщ. локального прогресса есть пометка об удалении; нужно сверить
        // счётчик с актуальным состоянием backend
        const hasPendingDeletion = conversation.localRead?.messages.some((message) => message.isDeleted);
        // Если после серверного снимка пришло новое сообщение или удаление,
        // сохраняем локальный preview и число; GET уточнит остаток уже для новой границы.
        if (hasNewerLocalMessage || snapshotMessageWasDeleted || hasPendingDeletion) {
            needsReload = true;
            // Граница и число остаются из одного подтверждённого состояния до серверной сверки.
            return conversation;
        }

        hasChanges = true;
        let lastMessage = result.lastMessage;
        // Если текст того же preview уже отредактирован позже, не откатываем его.
        if (
            lastMessage &&
            oldLastMessage?.id === lastMessage.id &&
            Date.parse(oldLastMessage.updatedAt) > Date.parse(lastMessage.updatedAt)
        ) {
            lastMessage = oldLastMessage;
        }
        // Сохраняем localRead, только если пользователь уже увидел дальше, чем подтвердил этот результат
        // Локально увидел до №45, backend подтв. до №43 => сохр.: 44-45 ещё ожид. подтверждения
        // Локально увидел до №45, backend подтв. до 45 или дальше. => убираем, подтвержд. уже покрыло локал. прогресс
        const localRead =
            conversation.localRead && isReadPositionNewer(conversation.localRead.readState, result.readState)
                ? conversation.localRead
                : undefined;
        return {
            ...conversation,
            readState: result.readState,
            unreadCount: result.unreadCount,
            lastMessage,
            localRead,
        };
    });
    return {
        conversations: hasChanges ? sortConversationsByLastMessage(updatedConversations) : conversations,
        needsReload: needsReload || !conversationFound,
    };
};
