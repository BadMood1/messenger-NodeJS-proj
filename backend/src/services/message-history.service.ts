import { AppError } from "../errors/app-error.js";
import { Prisma } from "../generated/prisma/client.js";
import { messageInclude } from "../lib/message-include.js";
import { prisma } from "../lib/prisma.js";

type HistoryDirection = "older" | "newer";
type MessagePosition = { id: string | null; createdAt: Date };
type HistoryMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

export type MessageHistoryOptions = {
    cursor?: string | undefined;
    cursorCreatedAt?: string | undefined;
    direction?: HistoryDirection;
    mode?: "latest" | "unread";
    limit?: number;
};

// ------- УСЛОВИЯ ПЕРЕХОДА ПО ИСТОРИИ -------
// Получает позицию сообщения или границу прочтения и направление перехода.
// Сравнивает createdAt, а при одинаковой дате — id; без позиции ничего не ограничивает.
// Возвращает Prisma-условие для сообщений строго до или после позиции.
const getMessagePositionFilter = (
    position: MessagePosition | null,
    direction: HistoryDirection,
): Prisma.MessageWhereInput => {
    if (!position) return {};

    const dateComparison = direction === "older" ? { lt: position.createdAt } : { gt: position.createdAt };

    // Если у позиции есть только дата — сравниваем только её.
    if (position.id === null) return { createdAt: dateComparison };

    const idComparison = direction === "older" ? { lt: position.id } : { gt: position.id };

    // если есть id, то сравниваем и по нему тоже
    return {
        OR: [{ createdAt: dateComparison }, { createdAt: position.createdAt, id: idComparison }],
    };
};

// ------- ОДНА СТРАНИЦА -------
// Получает транзакцию, чат, позицию, направление и размер страницы.
// Загружает ближайшие сообщения в выбранную сторону и проверяет наличие следующей страницы.
// Возвращает сообщения от старых к новым и hasMore для выбранного направления.
const loadMessagePage = async (
    tx: Prisma.TransactionClient,
    conversationId: string,
    position: MessagePosition | null,
    direction: HistoryDirection,
    limit: number,
) => {
    const positionFilter = getMessagePositionFilter(position, direction);
    const order = direction === "older" ? "desc" : "asc";

    // Берём на 1 сообщение больше, чтобы понять, есть ли ещё сообщения в выбранную сторону.
    // Сам cursor второй раз не возвращаем: фильтр использует строгое сравнение.
    const messages = await tx.message.findMany({
        where: { conversationId, ...positionFilter },
        orderBy: [{ createdAt: order }, { id: order }],
        take: limit + 1,
        include: messageInclude,
    });

    // Если получили больше limit — значит история ещё есть.
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop(); // лишнее проверочное сообщение

    // Из БД при older получили от новых к старым. Для чата возвращаем от старых к новым.
    if (direction === "older") messages.reverse();

    return { messages, hasMore };
};

// ------- ФОРМАТ ОТВЕТА -------
// Получает сообщения страницы, наличие старых/новых страниц и необязательный id непрочитанного.
// Строит курсоры из крайних сообщений; дата в курсоре сохраняет позицию после удаления сообщения.
// Возвращает историю с двумя курсорами и прежним nextCursor для существующего frontend.
const buildMessageHistoryResponse = (
    messages: HistoryMessage[],
    hasOlder: boolean,
    hasNewer: boolean,
    firstUnreadMessageId: string | null = null,
) => {
    const firstMessage = messages[0];
    const lastMessage = messages.at(-1);
    const olderCursor =
        hasOlder && firstMessage ? { id: firstMessage.id, createdAt: firstMessage.createdAt } : null;
    const newerCursor =
        hasNewer && lastMessage ? { id: lastMessage.id, createdAt: lastMessage.createdAt } : null;

    return {
        messages,
        nextCursor: olderCursor?.id ?? null, // для совместимости со старым frontend
        olderCursor, // загрузка вверх
        newerCursor, // загрузка вниз
        firstUnreadMessageId, // при первом открытии прокручиваем к этому сообщению
    };
};

// ------- НАЧАЛЬНОЕ ОКНО ВОЗЛЕ НЕПРОЧИТАННОГО -------
// Получает транзакцию, чат, пользователя, его границу прочтения и размер окна.
// Находит первое чужое непрочитанное и загружает немного контекста до него и сообщения после.
// Возвращает окно с курсорами или null, если непрочитанных нет и нужна последняя страница.
const loadUnreadMessageWindow = async (
    tx: Prisma.TransactionClient,
    conversationId: string,
    userId: string,
    readPosition: MessagePosition | null,
    limit: number,
) => {
    // вернёт условие, чтобы потом читали после(newer) ПРОЧИТАННОГО сообщ.
    const afterReadBoundary = getMessagePositionFilter(readPosition, "newer");
    // первое чужое непрочитанное
    const firstUnreadMessage = await tx.message.findFirst({
        where: { conversationId, senderId: { not: userId }, ...afterReadBoundary },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, createdAt: true },
    });
    if (!firstUnreadMessage) return null;

    // До трети окна, максимум 15 сообщений, оставляем для контекста перед непрочитанным.
    const contextLimit = Math.min(15, Math.floor(limit / 3));
    // Пропускаем сообщения контекста и берём одно сообщение сразу ДО них.
    // Если его нет, весь контекст помещается — загружаем с начала чата.
    const beforeWindowPosition = await tx.message.findFirst({
        where: { conversationId, ...getMessagePositionFilter(firstUnreadMessage, "older") },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: contextLimit,
        select: { id: true, createdAt: true },
    });

    // запрос messages и получаем boolean hasMore
    const page = await loadMessagePage(tx, conversationId, beforeWindowPosition, "newer", limit);

    // Полные сообщения с sender/reply загружаем один раз, а не отдельно до и после непрочитанного.
    return buildMessageHistoryResponse(
        page.messages,
        beforeWindowPosition !== null,
        page.hasMore,
        firstUnreadMessage.id,
    );
};

// ------- ТОЧКА ВХОДА: ДОСТУП И РЕЖИМ ЗАГРУЗКИ -------
// Получает id чата, авторизованного пользователя и проверенные параметры history.
// Проверяет участие и выбирает последнее окно, окно непрочитанных или продолжение по cursor.
// Возвращает историю в едином формате; границу прочтения не изменяет.
export const getMessages = async (
    conversationId: string,
    userId: string,
    { cursor, cursorCreatedAt, direction = "older", mode = "latest", limit = 30 }: MessageHistoryOptions = {},
) => {
    // Границу, окно и наличие соседних страниц читаем из одного снимка БД.
    return prisma.$transaction(
        async (tx) => {
            // Проверяем, что пользователь состоит в этом чате.
            const member = await tx.conversationMember.findUnique({
                where: { conversationId_userId: { conversationId, userId } },
                select: { lastReadMessageId: true, lastReadMessageCreatedAt: true },
            });
            if (!member) throw new AppError(403, "You are not a member of this conversation");

            // ------- ПЕРВОЕ ОТКРЫТИЕ С НЕПРОЧИТАННЫМИ -------
            if (mode === "unread") {
                const readPosition =
                    member.lastReadMessageCreatedAt === null
                        ? null
                        : { id: member.lastReadMessageId, createdAt: member.lastReadMessageCreatedAt };
                // результат загрузки окна возле первого непрочитанного
                const unreadWindow = await loadUnreadMessageWindow(
                    tx,
                    conversationId,
                    userId,
                    readPosition,
                    limit,
                );
                if (unreadWindow) return unreadWindow;
                // Если непрочитанных нет, ниже загружаем обычную последнюю страницу.
            }

            // ------- CURSOR: ОТ КАКОГО МЕСТА ПРОДОЛЖАТЬ ИСТОРИЮ -------
            let cursorPosition: MessagePosition | null = null;
            if (cursor && cursorCreatedAt) {
                // Новому cursor не нужна живая запись сообщения: id и дата уже задают позицию.
                cursorPosition = { id: cursor, createdAt: new Date(cursorCreatedAt) };
            } else if (cursor) {
                // Старый frontend передаёт только id. Ищем дату только внутри разрешённого чата.
                cursorPosition = await tx.message.findFirst({
                    where: { id: cursor, conversationId },
                    select: { id: true, createdAt: true },
                });
                // Сохраняем прежний ответ для удалённого cursor: не подменяем его последней страницей.
                if (!cursorPosition) return buildMessageHistoryResponse([], false, false);
            }

            // ------- ПОСЛЕДНЯЯ СТРАНИЦА ИЛИ ПРОДОЛЖЕНИЕ -------
            const page = await loadMessagePage(tx, conversationId, cursorPosition, direction, limit);
            const firstMessage = page.messages[0];
            const lastMessage = page.messages.at(-1);
            if (!firstMessage || !lastMessage) return buildMessageHistoryResponse([], false, false);

            if (direction === "newer") {
                // Есть ли хоть одно сообщ. ДО начала полученной страницы?
                const olderMessage = await tx.message.findFirst({
                    where: { conversationId, ...getMessagePositionFilter(firstMessage, "older") },
                    select: { id: true },
                });
                return buildMessageHistoryResponse(page.messages, olderMessage !== null, page.hasMore);
            }

            // У обычной последней(снизу) страницы заведомо нет более новых сообщений в этом снимке.
            // GET /api/conversations/:id/messages?limit=30 значит "дай последние 30"
            if (!cursorPosition) return buildMessageHistoryResponse(page.messages, page.hasMore, false);

            // При дозагрузке старых сообщений от cursor (direction = older):
            // есть ли новее сообщения
            const newerMessage = await tx.message.findFirst({
                // после последнего сообщения страницы
                where: { conversationId, ...getMessagePositionFilter(lastMessage, "newer") },
                select: { id: true },
            });
            return buildMessageHistoryResponse(page.messages, page.hasMore, newerMessage !== null);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
};
