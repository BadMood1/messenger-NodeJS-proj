import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { getConversationReadSummaries } from "./conversation-read.service.js";

// Получает id текущего пользователя и необязательный id одного диалога.
// Загружает участников, последнее сообщение и прочтение, затем собирает общий ответ GET/POST.
// Возвращает массив готовых DIRECT-диалогов, отсортированный по последней активности.
export const loadDirectConversationResponses = async (userId: string, conversationId?: string) => {
    const conversationWhere: Prisma.ConversationWhereInput = {
        type: "DIRECT",
        members: {
            some: {
                userId, // есть ли среди участников хотя бы один с userId
            },
        },
    };
    // Если передан id — загружаем только один диалог для ответа POST.
    if (conversationId) conversationWhere.id = conversationId;

    // Транзакция объединяет несколько операций с БД в одну общую работу. (одинаковый снимок данных)
    const { conversations, readSummaries } = await prisma.$transaction(
        async (tx) => {
            // Берём только DIRECT-чаты, где состоит текущий пользователь.
            const conversations = await tx.conversation.findMany({
                // JOIN загружает участников и preview вместе с диалогами(объед. в 1 sql-запрос)
                // take: 1 применяется в БД, поэтому всю переписку для preview не читаем.
                relationLoadStrategy: "join",
                where: conversationWhere,

                include: {
                    members: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    username: true,
                                    image: true,
                                },
                            },
                        },
                    },
                    // Для preview берём только последнее сообщение каждого диалога.
                    messages: {
                        select: {
                            id: true,
                            content: true,
                            createdAt: true,
                            updatedAt: true,
                            senderId: true,
                        },
                        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                        take: 1,
                    },
                },

                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            });

            // Извлекаем свои границы прочтения ( до какого сообщения прочитали каждый чат)
            const readStates = conversations.map((conversation) => {
                const member = conversation.members.find((member) => member.userId === userId);
                if (!member) throw new AppError(500, "Failed to load conversation member");
                return {
                    conversationId: conversation.id,
                    lastReadMessageId: member.lastReadMessageId,
                    lastReadMessageCreatedAt: member.lastReadMessageCreatedAt,
                };
            });

            // К readStates добавляем unreadCount; первое непрочитанное отдельно определяет history endpoint.
            const readSummaries = await getConversationReadSummaries(tx, userId, readStates);
            return { conversations, readSummaries };
        },
        // настройка говорит БД запросы этой транзакции должны читать один снимок данных
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const readSummariesByConversationId = new Map(
        readSummaries.map((summary) => [summary.conversationId, summary]),
    );

    const conversationsWithLastMessage = conversations.map((conversation) => {
        // В DIRECT нас двое, поэтому ищем участника, который не мы
        const otherMember = conversation.members.find((member) => member.userId !== userId);
        const readSummary = readSummariesByConversationId.get(conversation.id);

        // Если метаданных нет, не подменяем неизвестный счётчик выдуманным нулём.
        if (!readSummary) throw new AppError(500, "Failed to load conversation read state");

        return {
            id: conversation.id,
            type: conversation.type,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,

            // На front нужен второй пользователь, а не весь массив members
            user: otherMember?.user ?? null,
            lastMessage: conversation.messages[0] ?? null,
            readState: {
                conversationId: conversation.id,
                userId,
                lastReadMessageId: readSummary.lastReadMessageId,
                lastReadMessageCreatedAt: readSummary.lastReadMessageCreatedAt,
            },
            // Граница собеседника нужна для галочек после первой загрузки и reconnect.
            peerReadState: otherMember
                ? {
                      conversationId: conversation.id,
                      userId: otherMember.userId,
                      lastReadMessageId: otherMember.lastReadMessageId,
                      lastReadMessageCreatedAt: otherMember.lastReadMessageCreatedAt,
                  }
                : null,
            unreadCount: readSummary.unreadCount,
        };
    });

    // Сначала более свежие диалоги.
    // Сравниваем дату последнего сообщения; если сообщений нет — дату создания диалога.
    // Возвращаем список от более новых дат к старым.
    return conversationsWithLastMessage.sort((firstConversation, secondConversation) => {
        const firstDate = firstConversation.lastMessage?.createdAt ?? firstConversation.createdAt;
        const secondDate = secondConversation.lastMessage?.createdAt ?? secondConversation.createdAt;

        return secondDate.getTime() - firstDate.getTime();
    });
};
