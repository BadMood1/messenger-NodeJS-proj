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
        },

        // Сначала более свежие диалоги
        orderBy: {
            updatedAt: "desc",
        },
    });

    return conversations.map((conversation) => {
        // В DIRECT нас двое, поэтому ищем участника, который не мы
        const otherMember = conversation.members.find((member) => member.userId !== userId);

        return {
            id: conversation.id,
            type: conversation.type,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,

            // На front нужен второй пользователь, а не весь массив members
            user: otherMember?.user ?? null,
        };
    });
};
