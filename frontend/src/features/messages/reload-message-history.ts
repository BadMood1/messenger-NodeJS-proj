import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { getMessages, type Message, type MessagesPage } from "./messages.api";

// Функция после reconnect заново загружает сообщения выбранного чата от самых новых до даты самого старого сообщения,
//  которое уже было загружено в UI. Она последовательно запрашивает страницы через cursor, собирает сообщения без дублей,
// сохраняет более свежие версии по updatedAt и сортирует результат по createdAt. Возвращает сообщения, nextCursor и hasMore
// для обновления state в вызывающем hook; при отмене или ошибке прерывает загрузку, не возвращая частичный результат.
export const reloadMessageHistory = async (
    conversationId: string,
    authenticatedRequest: AuthenticatedRequest,
    oldestLoadedAt: string | undefined, // createdAt самого старого уже загруженного серверного сообщения. undefined - первая загрузка истории(первая страница)
    signal: AbortSignal,
): Promise<MessagesPage> => {
    const messagesById = new Map<string, Message>();
    const requestedCursors = new Set<string>();
    let cursor: string | undefined;

    while (true) {
        signal.throwIfAborted(); // выброс ошибки при aborted
        const page = await getMessages(conversationId, authenticatedRequest, { cursor, limit: 50, signal });
        signal.throwIfAborted();

        // Если cursor удалили между страницами, пустой ответ не доказывает удаление всей старой истории.
        // т.е. при удаленном cursor, getMessages вернёт пустой массив (Prisma), но это не значит что история изменилась
        if (cursor && page.messages.length === 0) {
            throw new Error("History changed while syncing. Please retry.");
        }

        // Собираем страницы без дублей; если запись встретилась повторно — оставляем свежую версию.
        for (const message of page.messages) {
            const savedMessage = messagesById.get(message.id);
            if (!savedMessage || Date.parse(message.updatedAt) >= Date.parse(savedMessage.updatedAt)) {
                messagesById.set(message.id, message);
            }
        }

        const oldestOnPage = page.messages[0];
        // Если прошли загруженную границу или дошли до конца БД — сверка охватила весь открытый участок.
        // Равные даты не останавливают обход: несколько сообщений могут иметь один createdAt.
        if (
            !oldestLoadedAt || // получаем только 1-ю страницу если ещё не было загружено сообщ. и нет oldestLoadedAt соотв.
            !page.hasMore ||
            // дата самого старого полученной страницы < дата самого старого уже загруженного сообщения в UI (т.е. мы дошли до границы)
            (oldestOnPage && Date.parse(oldestOnPage.createdAt) < Date.parse(oldestLoadedAt)) // то что хотим < что есть ( 11:00 < 11:01 ) значит дошли до границы
        ) {
            return {
                messages: [...messagesById.values()].sort(
                    (first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt),
                ),
                nextCursor: page.nextCursor,
                hasMore: page.hasMore,
            };
        }

        // Не зацикливаем запросы, если backend не продвинул cursor.
        if (!page.nextCursor || requestedCursors.has(page.nextCursor)) {
            throw new Error("Failed to advance history cursor. Please retry.");
        }
        requestedCursors.add(page.nextCursor);
        cursor = page.nextCursor; // грузим дальше страницы, более старое время
    }
};
