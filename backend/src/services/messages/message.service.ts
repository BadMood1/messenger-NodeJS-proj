import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { Prisma } from "../../generated/prisma/client.js";
import { publishMessageCreated, publishMessageDeleted, publishMessageUpdated } from "../../realtime/socket.js";
import { createMessageSendTiming } from "./message-send-timing.js";
import { messageInclude } from "./message-include.js";
import { rejectPendingMessageSend, sendMessageInOrder } from "./message-send-order.js";

// Получает чат, автора, текст и необязательные id для Reply, Retry и порядка отправки.
// Проверяет права, возвращает существующее сообщение либо сохраняет новое и рассылает message:created.
// Возвращает серверное сообщение с sender и reply preview; данные для ответа получает до сохранения.
export const sendMessage = async (
    conversationId: string,
    senderId: string,
    content: string,
    replyToId?: string,
    clientMessageId?: string,
    previousClientMessageId?: string,
) => {
    const timing = createMessageSendTiming();
    const sendOrder = { conversationId, senderId, clientMessageId, previousClientMessageId };

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
        // ------- ПРОВЕРКИ И ДАННЫЕ ОТВЕТА -------
        // Одновременно получаем участников, ищем Retry и загружаем автора с необязательной цитатой.
        // Эти данные используем для ответа и доставки, чтобы не читать их после INSERT.
        const [members, existing, sender, replyTo] = await Promise.all([
            prisma.conversationMember.findMany({ where: { conversationId }, select: { userId: true } }),
            findExisting(),
            prisma.user.findUnique({ where: { id: senderId }, select: messageInclude.sender.select }),
            // Если это Reply, сразу получаем preview из того же чата; иначе запрос не нужен.
            replyToId
                ? prisma.message.findFirst({
                      where: { id: replyToId, conversationId },
                      select: messageInclude.replyTo.select,
                  })
                : null,
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

        if (!sender) {
            throw new AppError(404, "User not found");
        }

        // ------- REPLY -------
        // Не позволяем цитировать сообщения из другого чата, даже зная их id.
        if (replyToId && !replyTo) {
            throw new AppError(400, "Reply message must belong to this conversation");
        }

        // ------- СОХРАНЕНИЕ И ДОСТАВКА -------
        // Создаём само сообщение
        return await sendMessageInOrder(sendOrder, async (previous) => {
            timing.recordStage("orderWaitMs");
            // Время задаёт backend. Даже при совпадении миллисекунд следующая запись будет строго позже предыдущей.
            const createdAt = new Date(Math.max(Date.now(), previous ? previous.createdAt.getTime() + 1 : 0));
            try {
                // Сначала сохраняем в БД. Без include Prisma не загружает связи после INSERT.
                const savedMessage = await prisma.message.create({
                    data: {
                        content,
                        senderId,
                        conversationId,
                        replyToId: replyToId ?? null,
                        clientMessageId: clientMessageId ?? null, // сохраняем связь с temp-сообщением
                        createdAt,
                        updatedAt: createdAt,
                    },
                });
                timing.recordStage("createMs");

                // Сразу отдаём данные отправителя, чтобы front не делал ещё один запрос.
                // Автор и preview уже получены из БД; собираем прежний формат ответа без новых запросов.
                const message = { ...savedMessage, sender, replyTo };

                // После сохр. в БД публикуем в сокетах; участники уже получены в начале отправки.
                await publishMessageCreated(
                    message,
                    members.map((member) => member.userId),
                ).catch(() => {
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
        });
    } catch (error) {
        rejectPendingMessageSend(sendOrder, error);
        throw error;
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
        // Возвращаемые sender и reply preview загружаем через JOIN вместо отдельных чтений связей.
        relationLoadStrategy: "join",
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

// Получает id сообщения и авторизованного пользователя, проверяет автора.
// В транзакции удаляет сообщение и получает актуальный preview.
// Возвращает одинаковые данные для ответа DELETE и socket-события.
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

    const deletion = await prisma.$transaction(async (tx) => {
        await tx.message.delete({ where: { id: messageId } });
        // lastMessage, чтобы сформировать новое preview
        const lastMessage = await tx.message.findFirst({
            where: { conversationId: message.conversationId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, content: true, createdAt: true, updatedAt: true, senderId: true },
        });
        return { id: message.id, conversationId: message.conversationId, lastMessage };
    });
    // Сначала удаляем в БД, потом уведомляем. Ошибка публикации не отменяет успешный DELETE.
    await publishMessageDeleted(deletion).catch(() => {
        console.error("[socket] Failed to publish message:deleted");
    });
    return deletion;
};
