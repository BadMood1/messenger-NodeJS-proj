import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";
import { Prisma } from "../generated/prisma/client.js";
import { publishMessageCreated, publishMessageDeleted, publishMessageUpdated } from "../lib/socket.js";
import { createMessageSendTiming } from "../lib/message-send-timing.js";
import { messageInclude } from "../lib/message-include.js";

// Получает чат, автора, текст и необязательные id для Reply и Retry.
// Проверяет права, возвращает существующее сообщение либо сохраняет новое и рассылает message:created.
// Возвращает серверное сообщение с sender и reply preview; после сохранения повторно участников не запрашивает.
export const sendMessage = async (
    conversationId: string,
    senderId: string,
    content: string,
    replyToId?: string,
    clientMessageId?: string,
) => {
    const timing = createMessageSendTiming();

    // Использует senderId и clientMessageId текущей отправки.
    // Ищет ранее сохранённое сообщение вместе с данными автора и reply preview.
    // Возвращает запись или null; проверку доступа и принадлежности чату выполняем ниже.
    const findExisting = async () => {
        if (!clientMessageId) return null;
        return prisma.message.findUnique({
            where: { senderId_clientMessageId: { senderId, clientMessageId } },
            include: messageInclude,
        });
    };

    try {
        // ------- УЧАСТНИКИ И RETRY -------
        // Запросы независимы: одновременно получаем участников и ищем повтор clientMessageId.
        // Этот же список участников используем для доставки после сохранения.
        const [members, existing] = await Promise.all([
            prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } }),
            findExisting(),
        ]);
        timing.recordStage("checksMs");

        // Проверяем, что пользователь вообще состоит в этом чате.
        // Даже найденный Retry нельзя вернуть, пока не проверили доступ.
        if (!members.some((member) => member.userId === senderId)) {
            throw new AppError(403, "You are not a member of this conversation");
        }
        // Один client id не используем для разных чатов, даже если автор состоит в обоих.
        if (existing && existing.conversationId !== conversationId) {
            throw new AppError(409, "Client message id already used in another conversation");
        }
        if (existing) return existing; // POST уже сохранился, а ответ потерялся — Retry возвращает ту же запись

        // ------- REPLY -------
        if (replyToId) {
            // Не позволяем цитировать сообщения из другого чата, даже зная их id.
            const replyTo = await prisma.message.findFirst({
                where: { id: replyToId, conversationId },
                select: { id: true },
            });
            timing.recordStage("replyMs");
            if (!replyTo) {
                throw new AppError(400, "Reply message must belong to this conversation");
            }
        }

        // ------- СОХРАНЕНИЕ И ДОСТАВКА -------
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
            timing.recordStage("createMs");

            // После сохр. в БД публикуем в сокетах; участники уже получены в начале отправки.
            await publishMessageCreated(message, members.map((member) => member.userId)).catch(() => {
                console.error("[socket] Failed to publish message:created");
            });
            timing.recordStage("publishMs");
            return message;
        } catch (error) {
            timing.recordStage("createFailedMs");
            // Два одновременных POST могли оба не найти запись; unique разрешит создать только одну.
            if (
                clientMessageId &&
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002"
            ) {
                const existing = await findExisting();
                timing.recordStage("retryLookupMs");
                // Конкурентный запрос тоже мог использовать этот client id в другом чате.
                if (existing && existing.conversationId !== conversationId) {
                    throw new AppError(409, "Client message id already used in another conversation");
                }
                if (existing) return existing;
            }
            throw error;
        }
    } finally {
        timing.finish();
    }
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
    const updatedMessage = await prisma.message.update({
        where: {
            id: messageId,
        },

        data: {
            content,
        },

        include: messageInclude,
    });
    // PATCH остаётся успешным, даже если уведомление через socket не удалось отправить.
    await publishMessageUpdated(updatedMessage).catch(() => {
        console.error("[socket] Failed to publish message:updated");
    });
    return updatedMessage;
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
    // Сначала удаляем в БД, потом уведомляем. Ошибка публикации не отменяет успешный DELETE.
    await publishMessageDeleted(message).catch(() => {
        console.error("[socket] Failed to publish message:deleted");
    });
};
