import type { Prisma, ConversationMember } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

type SavedReadState = Pick<
    ConversationMember,
    "conversationId" | "userId" | "lastReadMessageId" | "lastReadMessageCreatedAt"
>;

// Получает подтверждённую границу прочтения пользователя.
// Одним SQL-запросом считает остаток непрочитанных и получает последнее сообщение в том же снимке.
// Возвращает готовый результат для ответа PATCH и события conversation:read.
export const getConversationReadResult = async (readState: SavedReadState) => {
    const unreadWhere: Prisma.MessageWhereInput = {
        conversationId: readState.conversationId,
        senderId: { not: readState.userId },
    };

    // Если граница есть, считаем только чужие сообщения после неё.
    if (readState.lastReadMessageCreatedAt !== null) {
        unreadWhere.OR = [{ createdAt: { gt: readState.lastReadMessageCreatedAt } }];
        if (readState.lastReadMessageId !== null) {
            // если id одинаковые
            unreadWhere.OR.push({
                createdAt: readState.lastReadMessageCreatedAt,
                id: { gt: readState.lastReadMessageId },
            });
        }
    }

    // JOIN объединяет preview и счётчик в один запрос: отдельная транзакция для снимка уже не нужна.
    const conversation = await prisma.conversation.findUnique({
        where: { id: readState.conversationId },
        relationLoadStrategy: "join",
        select: {
            _count: { select: { messages: { where: unreadWhere } } },
            messages: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 1,
                select: { id: true, content: true, createdAt: true, updatedAt: true, senderId: true },
            },
        },
    });

    return {
        readState,
        unreadCount: conversation?._count.messages ?? 0,
        lastMessage: conversation?.messages[0] ?? null,
    };
};

export type ConversationReadResult = Awaited<ReturnType<typeof getConversationReadResult>>;
