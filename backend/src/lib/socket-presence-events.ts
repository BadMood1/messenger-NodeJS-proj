import type { Server, Socket } from "socket.io";
import { z } from "zod";

import { prisma } from "./prisma.js";

// ------- ЗАПРОС И ОТВЕТ PRESENCE -------
const presenceRequestSchema = z.object({
    conversationId: z.string().uuid(),
});

type PresenceResponse =
    | { ok: true; presence: { conversationId: string; userId: string; isOnline: boolean } }
    | { ok: false; error: string };

// Получает Socket.IO-сервер и функцию чтения текущего online-статуса.
// Создаёт функции запроса статуса собеседника и доставки изменений участникам DIRECT-диалогов.
// Возвращает регистрацию обработчика и функцию отправки presence:updated.
export const createPresenceHandlers = (io: Server, isUserOnline: (userId: string) => boolean) => {
    // ------- ДОСТАВКА ИЗМЕНЕНИЙ СТАТУСА -------
    // Получает id пользователя, у которого подключился первый или отключился последний socket.
    // Находит его собеседников и отправляет текущий статус во все их подключённые вкладки.
    // Завершает доставку без исключения наружу; ошибку БД записывает в серверный лог.
    const publishPresenceChanged = async (userId: string) => {
        try {
            // Берём других участников DIRECT-диалогов этого пользователя, без повторяющихся userId.
            const recipients = await prisma.conversationMember.findMany({
                where: {
                    userId: { not: userId },
                    conversation: {
                        type: "DIRECT",
                        members: { some: { userId } },
                    },
                },
                select: { userId: true },
                distinct: ["userId"],
            });
            const rooms = recipients.map((recipient) => `user:${recipient.userId}`);
            if (!rooms.length) return;

            // За время запроса к БД пользователь мог переподключиться: читаем статус именно сейчас.
            io.to(rooms).emit("presence:updated", { userId, isOnline: isUserOnline(userId) });
        } catch {
            // Presence вызывается из connection/disconnect без await; не оставляем rejected Promise.
            console.error("[socket] Failed to publish presence");
        }
    };

    // ------- ЗАПРОС НАЧАЛЬНОГО СТАТУСА -------
    // Получает socket с проверенным userId из JWT.
    // Подключает обработчик presence:get для запроса статуса собеседника по conversationId.
    // Ответ на запрос отправляет только запросившему клиенту через acknowledgement.
    const registerPresenceHandlers = (socket: Socket) => {
        const userId: string = socket.data.userId;

        // Получает payload с conversationId и функцию ответа sendPresenceResponse от Socket.IO.
        // Проверяет срок JWT и участие в DIRECT-диалоге, затем читает статус другого участника.
        // Вызывает sendPresenceResponse с presence либо с ошибкой, не рассылая ответ остальным вкладкам.
        const handlePresenceRequest = async (
            payload: unknown,
            sendPresenceResponse?: (response: PresenceResponse) => void, // функция отправки ответа на этот запрос
        ) => {
            // Без callback ответить на запрос нельзя; запрос к БД в этом случае не запускаем.
            if (typeof sendPresenceResponse !== "function") return;

            const parsed = presenceRequestSchema.safeParse(payload);
            if (!parsed.success) {
                sendPresenceResponse({ ok: false, error: "Invalid presence request" });
                return;
            }
            if (!socket.connected || Date.now() >= socket.data.tokenExpiresAt) {
                sendPresenceResponse({ ok: false, error: "Unauthorized" });
                return;
            }

            try {
                // id пользователя берём из socket, а не из payload: нельзя запросить чужой диалог.
                const conversation = await prisma.conversation.findFirst({
                    where: {
                        id: parsed.data.conversationId,
                        type: "DIRECT",
                        members: { some: { userId } },
                    },
                    select: { members: { select: { userId: true } } },
                });

                // После ожидания БД повторно проверяем соединение и срок JWT.
                if (!socket.connected) return;
                if (Date.now() >= socket.data.tokenExpiresAt) {
                    sendPresenceResponse({ ok: false, error: "Unauthorized" });
                    return;
                }

                const otherMember = conversation?.members.find((member) => member.userId !== userId);
                if (!otherMember) {
                    sendPresenceResponse({ ok: false, error: "Conversation not found or access denied" });
                    return;
                }

                // ответ получает только вкладка, отправившая запрос
                sendPresenceResponse({
                    ok: true,
                    presence: {
                        conversationId: parsed.data.conversationId,
                        userId: otherMember.userId,
                        isOnline: isUserOnline(otherMember.userId),
                    },
                });
            } catch {
                console.error("[socket] Failed to load presence");
                if (socket.connected) sendPresenceResponse({ ok: false, error: "Failed to load presence" });
            }
        };

        socket.on("presence:get", handlePresenceRequest);
    };

    return { registerPresenceHandlers, publishPresenceChanged };
};
