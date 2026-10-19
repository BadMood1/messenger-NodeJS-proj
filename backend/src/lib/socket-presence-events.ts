import type { Server, Socket } from "socket.io";
import { z } from "zod";

import { prisma } from "./prisma.js";

// ------- ЗАПРОС И ОТВЕТ PRESENCE -------
const presenceRequestSchema = z.object({
    conversationId: z.string().uuid(),
});

type PresenceResponse =
    | {
          ok: true;
          presence: {
              conversationId: string;
              userId: string;
              isOnline: boolean;
              lastSeenAt: string | null;
          };
      }
    | { ok: false; error: string };

// Получает Socket.IO-сервер и функцию чтения текущего online-статуса.
// Создаёт функции запроса статуса собеседника и доставки изменений участникам DIRECT-диалогов.
// Возвращает регистрацию обработчика и функцию отправки presence:updated.
export const createPresenceHandlers = (io: Server, isUserOnline: (userId: string) => boolean) => {
    // Для каждого пользователя запоминаем версию последней начатой смены статуса.
    // Если во время запроса к БД появилась новая версия, старую рассылку пропускаем.
    const pendingPresenceVersions = new Map<string, number>();
    let nextPresenceVersion = 0;

    // ------- ДОСТАВКА ИЗМЕНЕНИЙ СТАТУСА -------
    // Получает id пользователя и время появления первой либо ухода последней активной вкладки.
    // Сохраняет lastSeenAt, находит собеседников и отправляет им текущий статус вместе со временем.
    // Завершает доставку без исключения наружу; ошибку БД записывает в серверный лог.
    const publishPresenceChanged = async (userId: string, lastSeenAt: Date) => {
        const presenceVersion = ++nextPresenceVersion;
        pendingPresenceVersions.set(userId, presenceVersion);

        try {
            // Сохранение времени и поиск собеседников не зависят друг от друга — запускаем параллельно.
            const [updatedUsers, recipients] = await Promise.all([
                // обновляем lastSeenAt и обновленных юзеров возвращаем
                // Если в БД уже более новое время, старый запрос его не заменит.
                prisma.user.updateManyAndReturn({
                    where: {
                        id: userId,
                        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: lastSeenAt } }],
                    },
                    data: { lastSeenAt },
                    select: { lastSeenAt: true },
                }),
                // Берём других участников DIRECT-диалогов этого пользователя, без повторяющихся userId.
                prisma.conversationMember.findMany({
                    where: {
                        userId: { not: userId },
                        conversation: {
                            type: "DIRECT",
                            members: { some: { userId } },
                        },
                    },
                    select: { userId: true },
                    distinct: ["userId"], // убрать дубликаты
                }),
            ]);

            // Если запрос устарел или уведомлять некого, дополнительное чтение БД не нужно.
            if (pendingPresenceVersions.get(userId) !== presenceVersion || !recipients.length) return;

            // Если UPDATE вернул пользователя, используем его время без отдельного SELECT.
            // Если обновления не было (время в БД такое же или новее), читаем сохранённое значение.
            const user =
                updatedUsers[0] ??
                (await prisma.user.findUnique({ where: { id: userId }, select: { lastSeenAt: true } }));

            // Во время findUnique мог начаться новый вызов, чекаем версию
            if (pendingPresenceVersions.get(userId) !== presenceVersion || !user) return;

            const rooms = recipients.map((recipient) => `user:${recipient.userId}`);

            // За время запроса к БД пользователь мог переподключиться: читаем статус именно сейчас.
            io.to(rooms).emit("presence:updated", {
                userId,
                isOnline: isUserOnline(userId),
                lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
            });
        } catch {
            // Presence вызывается из connection/disconnect без await; не оставляем rejected Promise.
            console.error("[socket] Failed to publish presence");
        } finally {
            // Если Map всё ещё хранит номер моего вызова — удаляю эту запись (при этом старый вызов не удалит новый)
            if (pendingPresenceVersions.get(userId) === presenceVersion)
                pendingPresenceVersions.delete(userId);
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
                    select: {
                        members: {
                            select: { userId: true, user: { select: { lastSeenAt: true } } },
                        },
                    },
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
                        lastSeenAt: otherMember.user.lastSeenAt?.toISOString() ?? null,
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
