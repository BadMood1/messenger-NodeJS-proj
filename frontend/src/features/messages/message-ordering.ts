import type { ClientMessage, Message } from "./messages.api";

type MessagePosition = Pick<Message, "id" | "createdAt">;
type MessageDisplayPosition = Pick<
    ClientMessage,
    "id" | "createdAt" | "clientMessageId" | "localDisplayOrder"
>;

// Получает серверные позиции двух сообщений.
// Сравнивает createdAt, а при совпадении даты — id.
// Возвращает порядок для истории, курсоров и прочтения.
export const compareMessagesByCreatedAt = (first: MessagePosition, second: MessagePosition) =>
    Date.parse(first.createdAt) - Date.parse(second.createdAt) || first.id.localeCompare(second.id);

// Получает отображаемые сообщения и время новой отправки.
// Находит позицию после всех сообщений, уже находящихся в списке.
// Возвращает локальный номер для сортировки
export const getNextLocalDisplayOrder = (
    messages: readonly Pick<ClientMessage, "createdAt" | "localDisplayOrder">[],
    sentAt: number,
) => {
    let lastDisplayOrder = sentAt;
    for (const message of messages) {
        lastDisplayOrder = Math.max(
            lastDisplayOrder,
            message.localDisplayOrder ?? Date.parse(message.createdAt),
        );
    }
    return lastDisplayOrder + 1;
};

// Получает два сообщения из отображаемого списка.
// Для своих локальных отправок использует сохранённую позицию, для остальных — серверную дату.
// Возвращает порядок ожидания; после завершения серии sortMessagesForDisplay переключит список на серверный.
export const compareMessagesForDisplay = (first: MessageDisplayPosition, second: MessageDisplayPosition) => {
    const firstDisplayOrder = first.localDisplayOrder ?? Date.parse(first.createdAt);
    const secondDisplayOrder = second.localDisplayOrder ?? Date.parse(second.createdAt);
    // При совпадении позиций локальная отправка сохраняет тот же ключ после получения server id.
    const firstStableKey =
        first.localDisplayOrder === undefined ? first.id : (first.clientMessageId ?? first.id);
    const secondStableKey =
        second.localDisplayOrder === undefined ? second.id : (second.clientMessageId ?? second.id);
    return firstDisplayOrder - secondDisplayOrder || firstStableKey.localeCompare(secondStableKey);
};

// Получает список сообщений после подтверждения, ошибки или сверки истории.
// Пока есть sending, сохраняет optimistic-позиции; когда серия завершена, убирает их у серверных сообщений.
// Возвращает новый список: подтверждённая история всегда переходит на общий серверный порядок.
export const sortMessagesForDisplay = (messages: ClientMessage[]): ClientMessage[] => {
    if (messages.some((message) => message.localStatus === "sending")) {
        return [...messages].sort(compareMessagesForDisplay);
    }
    return messages
        .map((message) => {
            if (message.localStatus || message.localDisplayOrder === undefined) return message;
            const confirmedMessage = { ...message };
            delete confirmedMessage.localDisplayOrder;
            return confirmedMessage;
        })
        .sort(compareMessagesForDisplay);
};
