import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { getMessages, type Message, type MessageHistoryCursor } from "./messages.api";

// Функция после reconnect заново загружает открытый участок от последнего загруженного сообщения до даты самого старого,
//  которое уже было загружено в UI. Она последовательно запрашивает страницы через cursor, собирает сообщения без дублей,
// сохраняет более свежие версии по updatedAt и сортирует результат по createdAt/id. Возвращает сообщения и курсоры
// для обновления state в вызывающем hook; при отмене или ошибке прерывает загрузку, не возвращая частичный результат.
// Если конец чата уже открыт, начинает с самых новых; иначе сохраняет границу newestLoadedPosition.
export const reloadMessageHistory = async (
    conversationId: string,
    authenticatedRequest: AuthenticatedRequest,
    oldestLoadedAt: string | undefined, // createdAt самого старого уже загруженного серверного сообщения. undefined - первая загрузка истории(первая страница)
    signal: AbortSignal,
    newestLoadedPosition: MessageHistoryCursor | null = null,
) => {
    const messagesById = new Map<string, Message>();
    const requestedCursors = new Set<string>();
    let cursor: MessageHistoryCursor | undefined;
    let newerCursor: MessageHistoryCursor | null = null;

    // ------- КОНЕЦ ОТКРЫТОГО УЧАСТКА -------
    // Если конец чата ещё не загружен, находим одно сообщение сразу после нашего окна.
    // Загружаем older от него: так в сверку попадёт и последнее сообщение самого окна.
    if (newestLoadedPosition) {
        // При reconnect нужно проверить и последнее известное сообщение окна, например №100.
        // older от №100 исключит само №100 из ответа — получим только №99 и более старые.
        // Поэтому сначала ищем №101 как cursor: older от него включит №100 для проверки правок/удаления.
        const afterWindow = await getMessages(conversationId, authenticatedRequest, {
            cursor: newestLoadedPosition.id,
            cursorCreatedAt: newestLoadedPosition.createdAt,
            direction: "newer",
            limit: 1,
            signal,
        });
        signal.throwIfAborted();
        const nextMessage = afterWindow.messages[0];
        if (nextMessage) cursor = { id: nextMessage.id, createdAt: nextMessage.createdAt };
        // Если после окна уже ничего нет, обычный запрос без cursor сверит конец чата.
    }

    // Перечитываем вверх, пока не проверим весь нужный участок или какие-то условия не сработают
    while (true) {
        signal.throwIfAborted(); // выброс ошибки при aborted
        const page = await getMessages(conversationId, authenticatedRequest, {
            cursor: cursor?.id,
            cursorCreatedAt: cursor?.createdAt,
            direction: "older",
            limit: 50,
            signal,
        });
        signal.throwIfAborted();

        // Если весь прежний участок удалили, открываем оставшийся конец чата вместо пустого окна без курсоров.
        if (cursor && page.messages.length === 0 && messagesById.size === 0) {
            return getMessages(conversationId, authenticatedRequest, { limit: 50, signal });
        }

        // Курсор вниз берём только у первой страницы, вверх — у последней. (края сверки)
        if (requestedCursors.size === 0) newerCursor = page.newerCursor;
        // Передаём дату вместе с id: удалённый cursor больше не превращает живую историю в пустую.

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
                    (first, second) =>
                        Date.parse(first.createdAt) - Date.parse(second.createdAt) ||
                        first.id.localeCompare(second.id),
                ),
                nextCursor: page.nextCursor,
                hasMore: page.hasMore,
                olderCursor: page.olderCursor,
                newerCursor,
            };
        }

        // Не зацикливаем запросы, если backend не продвинул cursor.
        if (!page.olderCursor || requestedCursors.has(page.olderCursor.id)) {
            throw new Error("Failed to advance history cursor. Please retry.");
        }
        requestedCursors.add(page.olderCursor.id);
        cursor = page.olderCursor; // грузим дальше страницы, более старое время
    }
};
