import type { ClientMessage, Message } from "./messages.api";

// REST-ответ и socket-событие проходят одинаковую замену, независимо от того, что пришло первым.
// добавл. серверное сообщение без дублей (в messagesBeforeMerge и возвр. дальше)
export const mergeMessage = (
    messagesBeforeMerge: ClientMessage[],
    receivedMessage: Message,
): ClientMessage[] => {
    // вдруг socket добавил, а затем пришёл ответ с POST
    const existingMessage = messagesBeforeMerge.find(
        (listedMessage) => listedMessage.id === receivedMessage.id && !listedMessage.localStatus,
    );
    // Если обновили сообщение, оставляем его, иначе юзаем пришедшее новое message (вдруг отредачили)
    const latestMessage =
        existingMessage && Date.parse(existingMessage.updatedAt) > Date.parse(receivedMessage.updatedAt)
            ? existingMessage
            : receivedMessage;
    // Убираем элементы, которые заменяем
    return messagesBeforeMerge
        .filter(
            (listedMessage) =>
                listedMessage.id !== receivedMessage.id && // серверный дубль
                !(
                    receivedMessage.clientMessageId && // соответствующее локальное сообщение
                    listedMessage.clientMessageId === receivedMessage.clientMessageId &&
                    listedMessage.senderId === receivedMessage.senderId
                ),
        )
        .concat(latestMessage) // убрали дубль и соответствующий temp, добавили одно серверное сообщение
        .sort(
            (firstMessage, secondMessage) =>
                Date.parse(firstMessage.createdAt) - Date.parse(secondMessage.createdAt),
        ); // ставим на место по времени отправки
};

// собирает новый список: заменяет старую серверную историю перечитанной, но сохраняет локальные отправки и сообщения, поступившие во время GET.
export const reconcileMessageHistory = (
    messagesNow: ClientMessage[],
    reloadedMessages: Message[],
    serverIdsBeforeReload: ReadonlySet<string>,
): ClientMessage[] => {
    // есть localStatus - локальное sending/failed или его id отсутств. в исходном наборе, значит сообщ. появилось во время сверки
    const messagesToKeep = messagesNow.filter(
        (message) => message.localStatus || !serverIdsBeforeReload.has(message.id),
    );

    let mergedMessages = messagesToKeep;
    // добавляем reloaded сообщения к сохранённым, убираем дубли и сортируем по времени отправки
    for (const reloadedMessage of reloadedMessages) {
        mergedMessages = mergeMessage(mergedMessages, reloadedMessage); // по 1-му добавл. в mergedMessages
    }

    return mergedMessages;
};

// Получает текущий массив сообщений и набор удаленных id.Возвр. новые сообщения без удаленных и без цитат на удаленные
export const removeDeletedMessages = (
    messagesBeforeDeletion: ClientMessage[],
    deletedMessageIds: Set<string>,
): ClientMessage[] =>
    messagesBeforeDeletion
        .filter((message) => !deletedMessageIds.has(message.id)) // убираем удалённые
        // В остальных сообщениях убираем цитаты на удалённые
        .map((message) =>
            message.replyToId && deletedMessageIds.has(message.replyToId)
                ? { ...message, replyToId: null, replyTo: null }
                : message,
        );

// Редактируем сообщения(заменяем на те, что из списка editedMessages)
const applySavedEdits = (
    messagesBeforeEdit: ClientMessage[],
    editedMessages: ReadonlyMap<string, Message>,
): ClientMessage[] =>
    messagesBeforeEdit.map((message) => {
        // По id сообщения из списка ищем правку, полученную через PATCH/socket.
        const savedEdit = editedMessages.get(message.id);
        // ЕСЛИ правки нет ИЛИ сообщение в списке новее правки — возвращаем сообщение без изменений.
        if (!savedEdit || Date.parse(message.updatedAt) > Date.parse(savedEdit.updatedAt)) return message;

        // Меняем только поля правки: целый старый объект мог бы вернуть устаревшую цитату.
        return { ...message, content: savedEdit.content, updatedAt: savedEdit.updatedAt };
    });

// Обновляем текст и дату ЦИТАТ в ответах.   Пример: ответ B цитирует A — обновить нужно цитату A внутри B.
const updateReplyPreviews = (
    messagesWithEdits: ClientMessage[],
    editedMessages: ReadonlyMap<string, Message>,
): ClientMessage[] => {
    // Подготовка: создаём таблицу id -> сообщение, чтобы дальше искать оригинал каждой цитаты по id.
    const latestSourceMessagesById = new Map(editedMessages);
    // Цель for: добавить загруженные сообщения в таблицу, оставляя для каждого самую свежую запись.
    // из editedMessages Map'а создаём Map со всеми нашими сообщениями(latestSourceMessagesById), если нет сообщения в нём, то просто добавляем,
    // если есть, но время более свежее, то обновляем, иначе оставляем(как раз наши отредактированные останутся).
    for (const loadedMessage of messagesWithEdits) {
        const messageAlreadyInMap = latestSourceMessagesById.get(loadedMessage.id);
        // ЕСЛИ записи нет — добавляем loadedMessage.
        // ЕСЛИ запись есть, но loadedMessage.updatedAt новее — заменяем запись на loadedMessage.
        // ИНАЧЕ оставляем запись таблицы без изменений, чтобы не заменить свежий текст старым.
        if (
            !messageAlreadyInMap ||
            Date.parse(loadedMessage.updatedAt) > Date.parse(messageAlreadyInMap.updatedAt)
        ) {
            latestSourceMessagesById.set(loadedMessage.id, loadedMessage);
        }
    }

    // ------- Получили таблицу всех сообщений, включая свежие правки, чтобы обновить цитаты в ответах. -------

    // Цель map: перебрать весь список сообщений и обновить цитаты в ответах.
    // Текст для цитат берём из подготовленной таблицы оригиналов.
    return messagesWithEdits.map((message) => {
        // получили на которое отвечаем
        const replyPreview = message.replyTo;
        // ЕСЛИ у сообщения нет цитаты — возвращаем его без изменений.
        if (!replyPreview) return message;

        // Ищем оригинал A по id из цитаты, НЕ по id самого ответа B.
        const latestSourceMessage = latestSourceMessagesById.get(replyPreview.id);
        // ЕСЛИ оригинал не найден — цитату не меняем.
        // ЕСЛИ оригинал найден, но его дата не новее даты цитаты — цитату тоже не меняем.
        if (
            !latestSourceMessage ||
            Date.parse(latestSourceMessage.updatedAt) <= Date.parse(replyPreview.updatedAt)
        ) {
            return message;
        }

        // ИНАЧЕ обновляем content и updatedAt цитаты A внутри ответа B. Текст самого B сохраняем.
        return {
            ...message,
            replyTo: {
                ...replyPreview,
                content: latestSourceMessage.content,
                updatedAt: latestSourceMessage.updatedAt,
            },
        };
    });
};

// Получает список сообщений и приводит его в соответствие с уже известными правками и удалениями.
export const applyKnownMessageChanges = (
    messagesBeforeChanges: ClientMessage[],
    editedMessages: ReadonlyMap<string, Message>,
    deletedMessageIds: Set<string>,
): ClientMessage[] => {
    // 1. Редактируем сообщения, заменяя их на более свежие правки из editedMessages, если они есть.
    const messagesWithEdits = applySavedEdits(messagesBeforeChanges, editedMessages);
    // 2. Обновляем цитаты на эти сообщения, не затирая более свежий текст цитат из GET.
    const messagesWithReplies = updateReplyPreviews(messagesWithEdits, editedMessages);
    // 3. Убираем удалённые сообщения и цитаты на них, чтобы правки не вернули удалённые данные.
    return removeDeletedMessages(messagesWithReplies, deletedMessageIds);
};
