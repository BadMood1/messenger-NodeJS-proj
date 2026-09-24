import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";

export const sendMessage = async (conversationId: string, senderId: string, content: string) => {
    // Проверяем, что пользователь вообще состоит в этом чате
    const member = await prisma.conversationMember.findUnique({
        where: {
            conversationId_userId: {
                conversationId,
                userId: senderId,
            },
        },
    });

    if (!member) {
        throw new AppError(403, "You are not a member of this conversation");
    }

    // Создаём само сообщение
    return prisma.message.create({
        data: {
            content,
            senderId,
            conversationId,
        },

        // Сразу отдаём данные отправителя, чтобы front не делал ещё один запрос
        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },
        },
    });
};

export const getMessages = async (conversationId: string, userId: string, cursor?: string, limit = 30) => {
    // cursor - от какого места(сообщ.) продолжать загрузку истории
    // Проверяем, что пользователь состоит в этом чате
    const member = await prisma.conversationMember.findUnique({
        where: {
            conversationId_userId: {
                conversationId,
                userId,
            },
        },
    });

    if (!member) {
        throw new AppError(403, "You are not a member of this conversation");
    }

    // Берём на 1 сообщение больше, чтобы понять,
    // есть ли ещё более старые сообщения (вернуло 31 = сообщений ещё больше)
    const messages = await prisma.message.findMany({
        where: {
            conversationId,
        },

        orderBy: {
            createdAt: "desc",
        },

        take: limit + 1,

        // Если cursor есть — продолжаем загрузку после него
        ...(cursor && {
            cursor: {
                id: cursor,
            },

            // Сам cursor второй раз не возвращаем
            skip: 1,
        }),

        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },
        },
    });

    // Если получили больше limit — значит история ещё есть
    const hasMore = messages.length > limit;

    if (hasMore) {
        messages.pop(); // лишнее проверочное сообщение
    }

    // Последний элемент здесь — самое старое сообщение текущей страницы
    const nextCursor = hasMore ? (messages[messages.length - 1]?.id ?? null) : null;

    // Из БД получили от новых к старым.
    // Для чата удобнее вернуть от старых к новым.
    messages.reverse();

    return {
        messages,
        nextCursor,
    };
};

export const editMessage = async (messageId: string, userId: string, content: string) => {
    // Ищем сообщение, чтобы проверить автора
    const message = await prisma.message.findUnique({
        where: {
            id: messageId,
        },
    });

    if (!message) {
        throw new AppError(404, "Message not found");
    }

    // Редактировать можно только своё сообщение
    if (message.senderId !== userId) {
        throw new AppError(403, "You cannot edit this message");
    }

    // возвр. обновлённый message и данные sender'а
    return prisma.message.update({
        where: {
            id: messageId,
        },

        data: {
            content,
        },

        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },
        },
    });
};

//
export const deleteMessage = async (messageId: string, userId: string) => {
    // Ищем сообщение, чтобы проверить автора
    const message = await prisma.message.findUnique({
        where: {
            id: messageId,
        },
    });

    if (!message) {
        throw new AppError(404, "Message not found");
    }

    // Удалять можно только своё сообщение
    if (message.senderId !== userId) {
        throw new AppError(403, "You cannot delete this message");
    }

    await prisma.message.delete({
        where: {
            id: messageId,
        },
    });
};
