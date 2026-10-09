import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyAccessToken } from "./jwt.js";
import { prisma } from "./prisma.js";
import type { Message } from "../generated/prisma/client.js";

let socketServer: Server | null = null; // REST-сервис использует тот же io, который создаём при запуске

export const initializeSocketServer = (httpServer: HttpServer, frontendOrigin: string) => {
    const io = new Server(httpServer, {
        // CORS Express не настраивает отдельный endpoint Socket.IO.
        cors: { origin: frontendOrigin },
    });
    socketServer = io;

    // Handshake содержит JWT, но userId берём только из проверенного sub.
    // io.use(...) — это **middleware для Socket.IO-подключений
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token; // то, что frontend передал через auth callback
            if (typeof token !== "string") throw new Error("Missing token");
            const payload = await verifyAccessToken(token); // проверяем подпись и срок JWT, не просто читаем его
            if (!payload.sub || typeof payload.exp !== "number") throw new Error("Invalid token");

            socket.data.userId = payload.sub; // сохраняем userId на сервере для этого соединения
            socket.data.tokenExpiresAt = payload.exp * 1000; // exp в секундах, Date.now() в миллисекундах
            next(); // проверка прошла; после middleware сможет сработать connection
        } catch {
            // Object.assign добавляет ошибке поле data; frontend получит его в connect_error.
            next(Object.assign(new Error("Unauthorized"), { data: { code: "UNAUTHORIZED" } }));
        }
    });

    io.on("connection", (socket) => {
        // Все вкладки одного пользователя получают одну server-controlled room.
        socket.join(`user:${socket.data.userId}`); // room для адресной доставки, не запись в БД

        // Отключаем когда истечёт access token
        const expiryTimer = setTimeout(
            () => socket.disconnect(true), // true также закрывает транспортное соединение
            Math.max(0, socket.data.tokenExpiresAt - Date.now()), // сколько осталось до exp; минимум 0 мс
        );

        // не захламляем production-логи
        if (process.env.NODE_ENV !== "production") {
            console.log(`[socket] connected: ${socket.id}`);
        }

        socket.on("disconnect", (reason) => {
            clearTimeout(expiryTimer); // socket уже отключён — таймер ему больше не нужен
            if (process.env.NODE_ENV !== "production") {
                console.log(`[socket] disconnected: ${socket.id}, ${reason}`);
            }
        });
    });

    return io;
};

// Находит участников чата и отправляет им готовое сообщение с данными автора и reply preview
export const publishMessageCreated = async (message: Message) => {
    if (!socketServer) return;
    // Берём пользователей конкретного чата, включая отправителя. Это userId, а не вкладки/socket'ы.
    const members = await prisma.conversationMember.findMany({
        where: { conversationId: message.conversationId },
        select: { userId: true },
    });
    // Для каждого участника выбираем его room user:<userId>.
    // При подключении socket.join(...) добавляет туда каждый socket этого пользователя:
    // например, две вкладки отправителя = два socket в одной его room.
    // user:<userId> — все подключения одного пользователя;
    const rooms = members.map((member) => `user:${member.userId}`);
    // emit получат все socket'ы внутри выбранных rooms — то есть все подключённые вкладки участников.
    if (rooms.length) socketServer.to(rooms).emit("message:created", message);
};
