import { Prisma, type ConversationMember } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";

type SavedReadState = Pick<
    ConversationMember,
    "conversationId" | "userId" | "lastReadMessageId" | "lastReadMessageCreatedAt"
>;

// Получает подтверждённую границу прочтения пользователя.
// В одном снимке сообщений считает остаток непрочитанных и получает последнее сообщение.
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

    return prisma.$transaction(
        async (tx) => {
            const unreadCount = await tx.message.count({ where: unreadWhere });
            const lastMessage = await tx.message.findFirst({
                where: { conversationId: readState.conversationId },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                select: { id: true, content: true, createdAt: true, updatedAt: true, senderId: true },
            });
            return { readState, unreadCount, lastMessage };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
};

export type ConversationReadResult = Awaited<ReturnType<typeof getConversationReadResult>>;
