import { AppError } from "../errors/app-error.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

type ConversationReadState = {
    conversationId: string;
    lastReadMessageId: string | null;
    lastReadMessageCreatedAt: Date | null;
};

type ConversationReadSummary = ConversationReadState & {
    unreadCount: number;
    firstUnreadMessageId: string | null;
};

const readStateSelect = {
    conversationId: true,
    userId: true,
    lastReadMessageId: true,
    lastReadMessageCreatedAt: true,
} as const;

// ------- ГРАНИЦЫ И НЕПРОЧИТАННЫЕ ДЛЯ СПИСКА ДИАЛОГОВ -------
// берёт границы прочтения пользователя и для каждого чата вычисляет:
// сколько чужих сообщений не прочитано и какое из них первое
export const getConversationReadSummaries = async (
    tx: Prisma.TransactionClient,
    userId: string,
    readStates: ConversationReadState[],
): Promise<ConversationReadSummary[]> => {
    if (readStates.length === 0) return [];

    // ------- ЧТО СЧИТАЕМ НЕПРОЧИТАННЫМ -------
    const conversationFilters = readStates.map((state): Prisma.MessageWhereInput => {
        const { conversationId, lastReadMessageCreatedAt, lastReadMessageId } = state;

        // Если границы нет — берём все сообщения чата.
        if (lastReadMessageCreatedAt === null) {
            return { conversationId };
        }

        const afterReadDate = {
            createdAt: { gt: lastReadMessageCreatedAt },
        };

        // Если сохранена только дата — ищем сообщения позже неё.
        if (lastReadMessageId === null) {
            return {
                conversationId,
                ...afterReadDate,
            };
        }

        // Если сохранены дата и id — сравниваем дату, а при совпадении ещё и id.
        return {
            conversationId,
            OR: [
                afterReadDate,
                {
                    createdAt: lastReadMessageCreatedAt,
                    id: { gt: lastReadMessageId },
                },
            ],
        };
    });

    // собираем общее условие непрочитанности
    // "Найди ЧУЖИЕ сообщения, которые находятся после моей границы в соответствующем чате"
    const unreadWhere: Prisma.MessageWhereInput = {
        senderId: { not: userId },
        OR: conversationFilters,
    };

    // ------- КОЛИЧЕСТВО И ПЕРВАЯ ДАТА -------
    // возвращ. для каждого conversationId и остальное(можно чекнуть)
    // Если у чата нет непрочитанных, объекта для него в этом массиве не будет.
    const unreadGroups = await tx.message.groupBy({
        by: ["conversationId"],
        where: unreadWhere, // только чужие непрочитанные
        _count: { _all: true }, // в конце вернём из ф-ции
        _min: { createdAt: true }, // самая ранняя(первая) дата непрочитанного
    });

    // unreadGroups - для каждого id храним дату первого непрочитанного

    // если ни в одном переданном чате нет непрочитанных
    if (unreadGroups.length === 0) {
        return readStates.map((state) => ({ ...state, unreadCount: 0, firstUnreadMessageId: null }));
    }

    // ------- ПЕРВОЕ СООБЩЕНИЕ НА НАЙДЕННОЙ ДАТЕ -------

    // Для каждого чата создаём условие: id этого чата и его первая непрочитанная дата.
    const firstUnreadDateFilters = unreadGroups.map((group) => {
        if (!group._min.createdAt) {
            throw new AppError(500, "Failed to load first unread message date");
        }

        return {
            conversationId: group.conversationId,
            createdAt: group._min.createdAt,
        };
    });

    // Сообщение должно совпасть хотя бы с одной парой «чат + первая дата».
    // Выбираем одну подходящую пару из всех пар(OR относится к парам именно, если AND,
    // то будет относится к двум chat id - это невозможно)
    const earliestUnreadDateFilter: Prisma.MessageWhereInput = {
        OR: firstUnreadDateFilters,
    };

    // ОДНОВРЕМЕННО чужое непрочитанное И на первой непрочитанной дате своего чата
    // т.е. те, которые на той же дате первой непрочитанной, но наши, отфильтруются. Также как и чужие,
    // которые позже даты
    const firstUnreadMessageFilter: Prisma.MessageWhereInput = {
        AND: [unreadWhere, earliestUnreadDateFilter],
    };

    // Для каждого чата берём id первого непрочитанного сообщения
    const firstUnreadGroups = await tx.message.groupBy({
        by: ["conversationId"],
        where: firstUnreadMessageFilter,
        // Допускаем совпадение дат, тогда сравниваем id
        _min: { id: true },
    });

    // ------- МЕТАДАННЫЕ ДЛЯ ВСЕХ ДИАЛОГОВ -------
    const unreadCountsByConversationId = new Map(
        unreadGroups.map((group) => [group.conversationId, group._count._all]),
    );
    const firstUnreadIdsByConversationId = new Map(
        firstUnreadGroups.map((group) => [group.conversationId, group._min.id]),
    );

    return readStates.map((state) => {
        const unreadCount = unreadCountsByConversationId.get(state.conversationId) ?? 0;
        const firstUnreadMessageId = firstUnreadIdsByConversationId.get(state.conversationId) ?? null;
        if (unreadCount > 0 && !firstUnreadMessageId) {
            throw new AppError(500, "Failed to load first unread message");
        }
        return { ...state, unreadCount, firstUnreadMessageId };
    });
};

// ------- СОХРАНЕНИЕ ПРОЧТЕНИЯ -------
// Получает id чата, авторизованного пользователя и последнего прочитанного сообщения.
// Проверяет участника и сообщение, затем сдвигает сохранённую границу только вперёд.
// Возвращает границу этого пользователя, в том числе если более новый запрос уже опередил текущий.
export const markConversationRead = async (conversationId: string, userId: string, messageId: string) => {
    // ------- ПРОВЕРКА УЧАСТНИКА И СООБЩЕНИЯ -------
    // Проверки независимы: одновременно читаем участника и сообщение, без изменения данных.
    const [member, message] = await Promise.all([
        // ищем не просто пользователя, а его участие в чате
        prisma.conversationMember.findUnique({
            where: { conversationId_userId: { conversationId, userId } },
            select: { userId: true },
        }),
        // принадлежит ли сообщ. этому чату
        prisma.message.findFirst({
            where: { id: messageId, conversationId },
            select: { id: true, createdAt: true },
        }),
    ]);

    // Если участника нет, не раскрываем результат поиска сообщения.
    if (!member) throw new AppError(403, "You are not a member of this conversation");
    if (!message) throw new AppError(404, "Message not found in this conversation");

    // ------- СДВИГ ГРАНИЦЫ ТОЛЬКО ВПЕРЁД -------
    // Условие проверяет сама БД в момент UPDATE: две вкладки не смогут откатить границу назад.
    const updatedMembers = await prisma.conversationMember.updateManyAndReturn({
        where: {
            conversationId,
            userId,
            OR: [
                // границы ещё нет
                { lastReadMessageCreatedAt: null },
                // сохранённая дата границы < дата переданного сообщения
                { lastReadMessageCreatedAt: { lt: message.createdAt } },
                // Если даты совпали, более поздним считаем сообщение с большим id.
                {
                    lastReadMessageCreatedAt: message.createdAt,
                    lastReadMessageId: { lt: message.id },
                },
            ],
        },
        data: {
            lastReadMessageId: message.id,
            lastReadMessageCreatedAt: message.createdAt,
        },
        select: readStateSelect,
    });

    // ------- АКТУАЛЬНЫЙ РЕЗУЛЬТАТ -------
    // Если UPDATE пропущен, читаем уже сохранённую границу: повторный или старый запрос тоже успешен.
    const readState =
        updatedMembers[0] ??
        (await prisma.conversationMember.findUnique({
            where: { conversationId_userId: { conversationId, userId } },
            select: readStateSelect,
        }));

    // Если после пропущенного UPDATE участник уже отсутствует, возвращаем ошибку доступа.
    if (!readState) throw new AppError(403, "You are not a member of this conversation");

    return readState;
};
