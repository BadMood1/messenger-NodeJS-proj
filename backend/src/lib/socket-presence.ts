import type { Socket } from "socket.io";
import { z } from "zod";

const presenceActivitySchema = z.object({ isActive: z.boolean() });

// Создаётся один раз при запуске Socket.IO-сервера.
// Хранит socket.id видимых вкладок в фокусе отдельно для каждого пользователя.
// Возвращает регистрацию подключения и проверку online-статуса.
export const createPresenceTracker = () => {
    // ------- РЕЕСТР ПОДКЛЮЧЕНИЙ -------
    // Ключ — userId, значение — его активные вкладки/устройства, а не все подключения.
    // Есть хотя бы одна активная вкладка — online; иначе записи в Map нет.
    const activeSocketsByUser = new Map<string, Set<string>>();

    // ------- ЧТЕНИЕ СТАТУСА -------
    // Получает id пользователя.
    // Проверяет, осталась ли у него хотя бы одна активная вкладка в реестре.
    // Возвращает true для online и false для offline.
    const isUserOnline = (userId: string) => {
        return activeSocketsByUser.has(userId);
    };

    // ------- ПОДКЛЮЧЕНИЕ / ОТКЛЮЧЕНИЕ -------
    // Получает socket, который уже прошёл проверку JWT.
    // Принимает активность вкладки и ставит обработчик disconnect для очистки.
    // Пользователь становится online с первой активной вкладкой и offline после ухода из последней.
    // При смене статуса передаёт в функцию доставки id пользователя и серверное время перехода.
    const registerConnection = (
        socket: Socket,
        onPresenceChanged: (userId: string, lastSeenAt: Date) => Promise<void>,
    ) => {
        const userId: string = socket.data.userId; // проверенный автор из socket middleware

        // Получает признак активности именно этой вкладки.
        // Добавляет её socket.id в Set или убирает его, сохраняя остальные активные вкладки.
        // При смене общего online-статуса передаёт userId и серверное время в onPresenceChanged.
        const updateActivity = (isActive: boolean) => {
            const wasOnline = isUserOnline(userId); // запоминаем статус до изменения Set
            const activeSockets = activeSocketsByUser.get(userId) ?? new Set<string>();

            if (isActive) activeSockets.add(socket.id);
            else activeSockets.delete(socket.id);

            if (activeSockets.size > 0) activeSocketsByUser.set(userId, activeSockets);
            else activeSocketsByUser.delete(userId);

            // Повторные focus/blur не меняют общий статус и не запускают запись в БД.
            if (wasOnline !== isUserOnline(userId)) void onPresenceChanged(userId, new Date());
        };

        // Получает payload presence:activity от подключённой вкладки.
        // Проверяет boolean isActive и срок JWT; userId всегда берёт из проверенного socket.
        // Обновляет активность только этого подключения, не закрывая его.
        const handleActivity = (payload: unknown) => {
            const parsed = presenceActivitySchema.safeParse(payload);
            if (!parsed.success || !socket.connected || Date.now() >= socket.data.tokenExpiresAt) return;
            updateActivity(parsed.data.isActive);
        };

        // Вызывается при disconnect именно этого socket.
        // Удаляет его обработчик активности и socket.id, сохраняя остальные активные вкладки.
        // Если отключилась последняя активная вкладка, пользователь становится offline.
        const unregisterConnection = () => {
            socket.off("presence:activity", handleActivity);
            updateActivity(false);
        };

        socket.on("presence:activity", handleActivity);
        // once выполняет очистку один раз при завершении этого подключения. (автоматически снимает обработчик)
        socket.once("disconnect", unregisterConnection);

        // Скрытая вкладка не становится online даже на мгновение при подключении.
        // При первой активации сохраняем отметку: если backend аварийно завершится, она останется в БД.
        updateActivity(socket.handshake.auth.isActive === true);
    };

    return { registerConnection, isUserOnline };
};
