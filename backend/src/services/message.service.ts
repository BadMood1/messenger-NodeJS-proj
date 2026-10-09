import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";
import { Prisma } from "../generated/prisma/client.js";
import { publishMessageCreated } from "../lib/socket.js";

// Preview содержит только один уровень: replyTo исходного сообщения не загружаем.
const messageInclude = {
    sender: {
        select: {
            id: true,
            name: true,
            username: true,
            image: true,
        },
    },
    replyTo: {
        select: {
            id: true,
            content: true,
            sender: { select: { id: true, name: true, username: true } },
        },
    },
} as const;

// После сохр. в БД  публикует в сокетах message:created
export const sendMessage = async (
    conversationId: string,
    senderId: string,
    content: string,
    replyToId?: string,
    clientMessageId?: string,
) => {
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

    const findExisting = async () => {
        if (!clientMessageId) return null;
        const existing = await prisma.message.findUnique({
            where: { senderId_clientMessageId: { senderId, clientMessageId } },
            include: messageInclude,
        });
        // Один client id не используем для разных чатов, даже если автор состоит в обоих.
        if (existing && existing.conversationId !== conversationId) {
            throw new AppError(409, "Client message id already used in another conversation");
        }
        return existing;
    };

    const existing = await findExisting();
    if (existing) return existing; // POST уже сохранился, а ответ потерялся — Retry возвращает ту же запись

    if (replyToId) {
        // Не позволяем цитировать сообщения из другого чата, даже зная их id.
        const replyTo = await prisma.message.findFirst({
            where: { id: replyToId, conversationId },
            select: { id: true },
        });
        if (!replyTo) {
            throw new AppError(400, "Reply message must belong to this conversation");
        }
    }

    // Создаём само сообщение
    try {
        // Сначала сохраняем в БД
        const message = await prisma.message.create({
            data: {
                content,
                senderId,
                conversationId,
                replyToId: replyToId ?? null,
                clientMessageId: clientMessageId ?? null, // сохраняем связь с temp-сообщением
            },

            // Сразу отдаём данные отправителя, чтобы front не делал ещё один запрос
            include: messageInclude,
        });
        // После сохр. в БД публикуем в сокетах
        await publishMessageCreated(message).catch(() => {
            console.error("[socket] Failed to publish message:created");
        });
        return message;
    } catch (error) {
        // Два одновременных POST могли оба не найти запись; unique разрешит создать только одну.
        if (
            clientMessageId &&
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            const existing = await findExisting();
            if (existing) return existing;
        }
        throw error;
    }
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

        include: messageInclude,
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

        include: messageInclude,
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
