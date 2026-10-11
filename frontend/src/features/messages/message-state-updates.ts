import type { ClientMessage, Message } from "./messages.api";

// REST-ответ и socket-событие проходят одинаковую замену, независимо от того, что пришло первым.
// добавл. серверное сообщение без дублей
export const mergeMessage = (current: ClientMessage[], message: Message): ClientMessage[] => {
    // вдруг socket добавил, а затем пришёл ответ с POST
    const existing = current.find((item) => item.id === message.id && !item.localStatus);
    // Если обновили сообщение, оставляем его, иначе юзаем пришедшее новое message (вдруг отредачили)
    const latest =
        existing && Date.parse(existing.updatedAt) > Date.parse(message.updatedAt) ? existing : message;
    // Убираем элементы, которые заменяем
    return current
        .filter(
            (item) =>
                item.id !== message.id && // серверный дубль
                !(
                    message.clientMessageId && // соответствующее локальное сообщение
                    item.clientMessageId === message.clientMessageId &&
                    item.senderId === message.senderId
                ),
        )
        .concat(latest) // убрали дубль и соответствующий temp, добавили одно серверное сообщение
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)); // ставим на место по времени отправки
};

// Получает текущий массив сообщений и набор удаленных id.Возвр. новые сообщения без удаленных и без цитат на удаленные
export const removeDeletedMessages = (current: ClientMessage[], deletedIds: Set<string>): ClientMessage[] =>
    current
        .filter((message) => !deletedIds.has(message.id)) // убираем удалённые
        // В остальных сообщениях убираем цитаты на удалённые
        .map((message) =>
            message.replyToId && deletedIds.has(message.replyToId)
                ? { ...message, replyToId: null, replyTo: null }
                : message,
        );

export const updateEditedMessage = (current: ClientMessage[], message: Message): ClientMessage[] =>
    // Обновляем также цитаты этого сообщения, чтобы они совпадали с будущим GET.
    current.map((currentMessage) => {
        if (currentMessage.id === message.id) return message;
        if (currentMessage.replyTo?.id === message.id) {
            return {
                ...currentMessage,
                replyTo: { ...currentMessage.replyTo, content: message.content },
            };
        }
        return currentMessage;
    });
