import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";

// Если DM уже был — возвращает существующий. Если не было — создаёт и возвращает новый
export const getOrCreateDirectConversation = async (currentUserId: string, otherUserId: string) => {
    // Самому себе чат пока не создаём
    if (currentUserId === otherUserId) {
        throw new AppError(400, "You cannot create a conversation with yourself");
    }

    // Проверяем, что пользователь существует
    const otherUser = await prisma.user.findUnique({
        where: {
            id: otherUserId,
        },
        select: {
            id: true,
        },
    });

    if (!otherUser) {
        throw new AppError(404, "User not found");
    }

    // Сортируем id, чтобы для одной пары всегда был один ключ
    const directKey = [currentUserId, otherUserId].sort().join(":");

    // Если чат уже есть — получим его, иначе создадим
    return prisma.conversation.upsert({
        where: {
            directKey,
        },

        update: {},

        create: {
            type: "DIRECT",
            directKey,

            members: {
                create: [{ userId: currentUserId }, { userId: otherUserId }],
            },
        },

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
        },
    });
};

// Получает id текущего пользователя.
// Загружает его DIRECT-диалоги, собеседников и по одному последнему сообщению.
// Возвращает диалоги от новых к старым по дате сообщения или создания пустого чата.
export const getDirectConversations = async (userId: string) => {
    // Берём только DIRECT-чаты, где состоит текущий пользователь
    const conversations = await prisma.conversation.findMany({
        where: {
            type: "DIRECT",

            members: {
                some: {
                    userId, // есть ли среди участников хотя бы один с userId
                },
            },
        },

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

    const conversationsWithLastMessage = conversations.map((conversation) => {
        // В DIRECT нас двое, поэтому ищем участника, который не мы
        const otherMember = conversation.members.find((member) => member.userId !== userId);

        return {
            id: conversation.id,
            type: conversation.type,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,

            // На front нужен второй пользователь, а не весь массив members
            user: otherMember?.user ?? null,
            lastMessage: conversation.messages[0] ?? null,
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
