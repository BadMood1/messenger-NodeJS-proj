import type { Server, Socket } from "socket.io";
import { z } from "zod";

import { prisma } from "./prisma.js";

// ------- ДАННЫЕ TYPING -------
const typingSchema = z.object({
    conversationId: z.string().uuid(),
    isTyping: z.boolean(),
});

// Backend: через 5 секунд после последнего разрешённого true снимаем typing этого socket.
// Если false или disconnect пришли раньше, снимаем сразу, не дожидаясь таймера.
const TYPING_TIMEOUT_MS = 5000;

type ActiveTyping = {
    conversationId: string;
    recipientRooms: string[]; // кому сообщать об остановке
    timeout: ReturnType<typeof setTimeout>; // созданный таймер, чтобы его можно было отменить
};

// ------- ОБЩЕЕ СОСТОЯНИЕ И ПОДКЛЮЧЕНИЕ ОБРАБОТЧИКОВ -------
// Получает общий Socket.IO-сервер.
// Хранит в памяти, какие подключения(вкладки) каждого пользователя сейчас печатают в чате.
// Возвращает функцию регистрации typing-обработчиков для одного socket.
// Несколько подключений могут печатать в одном чате или в нескольких
export const createTypingHandlers = (io: Server) => {
    // ключ: conversationId:userId, значение: Set из socket.id вкладки (подключения к Socket.IO серверу печатающих в этом чате)
    const typingSocketsByUser = new Map<string, Set<string>>();

    // Получает socket, который уже прошёл проверку JWT.
    // Подключает приём typing и очистку состояния при disconnect.
    // Хранит текущий чат и таймер остановки только для этого подключения.
    const registerTypingHandlers = (socket: Socket) => {
        const userId: string = socket.data.userId; // автор из middleware, не из клиентского payload
        let activeTyping: ActiveTyping | null = null;
        let requestVersion = 0; // отличает последнюю команду от проверок членства, которые ещё ждут БД

        // ------- ОСТАНОВКА НАБОРА -------
        // Вызывается при stop, смене чата, disconnect или истечении таймера.
        // Убирает это подключение из набора печатающих вкладок пользователя.
        // Отправляет isTyping: false, только если других печатающих вкладок в этом чате нет.
        const stopTyping = () => {
            if (!activeTyping) return;
            const previousTyping = activeTyping;
            activeTyping = null;
            // При раннем false/disconnect отменяем запланированную остановку через 5 секунд.
            clearTimeout(previousTyping.timeout);

            const typingKey = `${previousTyping.conversationId}:${userId}`;
            const typingSockets = typingSocketsByUser.get(typingKey);
            typingSockets?.delete(socket.id);
            // Если другая вкладка ещё печатает — общий индикатор пользователя оставляем.
            if (typingSockets?.size) return;
            typingSocketsByUser.delete(typingKey);

            // сообщаем собеседнику об остановке (в румы получателей)
            io.to(previousTyping.recipientRooms).emit("conversation:typing", {
                conversationId: previousTyping.conversationId,
                userId,
                isTyping: false,
            });
        };

        // ------- ПРИЁМ СОБЫТИЯ И ПРОВЕРКА ЧЛЕНСТВА -------
        // Получает от клиента id чата и признак набора текста.
        // Проверяет данные и участие автора, затем обновляет временный typing-статус.
        // Отправляет статус в rooms остальных участников, не записывая его в БД.
        const handleTyping = async (payload: unknown) => {
            const parsed = typingSchema.safeParse(payload);
            if (!parsed.success || !socket.connected || Date.now() >= socket.data.tokenExpiresAt) return;
            const { conversationId, isTyping } = parsed.data;
            // увел. requestVersion на 1
            const currentVersion = ++requestVersion;

            if (!isTyping) {
                // Остановить можно только свой статус, ранее разрешённый проверкой членства.
                // Получили false от frontend после паузы, Send или ухода из input.
                // Останавливаем сразу: ещё 5 секунд не ждём.
                if (activeTyping?.conversationId === conversationId) stopTyping();
                return;
            }

            try {
                const members = await prisma.conversationMember.findMany({
                    where: { conversationId },
                    select: { userId: true },
                });
                // Если за время запроса к БД пришёл stop/другой typing или socket отключился — ответ не применяем.
                if (
                    currentVersion !== requestVersion ||
                    !socket.connected ||
                    Date.now() >= socket.data.tokenExpiresAt
                )
                    return;

                // --- Проверяем членство
                if (!members.some((member) => member.userId === userId)) return;

                // --- Собираем получателей(формируем из id - rooms)
                const recipientRooms = members
                    .filter((member) => member.userId !== userId)
                    .map((member) => `user:${member.userId}`);
                if (!recipientRooms.length) return;

                // Если начали печатать в другом чате — сначала снимаем статус в предыдущем.
                if (activeTyping && activeTyping.conversationId !== conversationId) stopTyping();
                // Новый разрешённый true отменяет прежний таймер; ниже начнутся новые 5 секунд.
                if (activeTyping) clearTimeout(activeTyping.timeout);

                const typingKey = `${conversationId}:${userId}`;
                // берём существующий Set socket.id или создаём новый, если нет
                const typingSockets = typingSocketsByUser.get(typingKey) ?? new Set<string>();
                // добавляем текущее подключение в набор печатающих вкладок пользователя
                typingSockets.add(socket.id);
                typingSocketsByUser.set(typingKey, typingSockets);

                // Каждый новый typing продлевает срок; без новых событий статус сам исчезнет.
                // Если false от отправителя не придёт, backend stopTyping уберёт этот socket из Set.
                // Если других печатающих вкладок пользователя нет, он отправит false собеседникам.
                const timeout = setTimeout(stopTyping, TYPING_TIMEOUT_MS);
                timeout.unref(); // этот таймер не удерживает процесс при завершении сервера
                activeTyping = { conversationId, recipientRooms, timeout };

                io.to(recipientRooms).emit("conversation:typing", { conversationId, userId, isTyping: true });
            } catch {
                // Ошибка БД не должна стать необработанным rejection socket-listener.
                console.error("[socket] Failed to handle conversation:typing");
            }
        };

        socket.on("conversation:typing", handleTyping);
        socket.on("disconnect", stopTyping);
    };

    return registerTypingHandlers;
};
