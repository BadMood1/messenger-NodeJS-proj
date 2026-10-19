import type { Socket } from "socket.io";

// Создаётся один раз при запуске Socket.IO-сервера.
// Хранит активные socket.id отдельно для каждого пользователя.
// Возвращает регистрацию подключения и проверку online-статуса.
export const createPresenceTracker = () => {
    // ------- РЕЕСТР ПОДКЛЮЧЕНИЙ -------
    // Ключ — userId, значение — все его подключённые вкладки/устройства.
    // Есть хотя бы один socket — online; нет подключений — записи в Map нет.
    const socketsByUser = new Map<string, Set<string>>();

    // ------- ЧТЕНИЕ СТАТУСА -------
    const isUserOnline = (userId: string) => {
        return socketsByUser.has(userId);
    };

    // ------- ПОДКЛЮЧЕНИЕ / ОТКЛЮЧЕНИЕ -------
    // Получает socket, который уже прошёл проверку JWT.
    // Добавляет его id в подключения пользователя и ставит обработчик disconnect.
    // Пользователь становится online с первым socket и offline после отключения последнего.
    // При смене статуса вызывает переданную функцию доставки уведомлений.
    const registerConnection = (socket: Socket, onPresenceChanged: (userId: string) => Promise<void>) => {
        const userId: string = socket.data.userId; // проверенный автор из socket middleware
        const wasOnline = isUserOnline(userId); // запоминаем статус до добавления нового socket
        const connectedSockets = socketsByUser.get(userId) ?? new Set<string>();
        // Записываем подключение в соотв. Set
        connectedSockets.add(socket.id);
        socketsByUser.set(userId, connectedSockets);

        // Вызывается при disconnect именно этого socket.
        // Удаляет его id, сохраняя остальные подключения пользователя.
        // Если отключилась последняя вкладка, удаляет запись пользователя: он теперь offline.
        const unregisterConnection = () => {
            const userSockets = socketsByUser.get(userId);
            if (!userSockets) return;

            userSockets.delete(socket.id);
            // Если остались другие подключения, пользователь всё ещё online — уведомление не нужно.
            if (userSockets.size > 0) return;

            socketsByUser.delete(userId);
            void onPresenceChanged(userId); // доставку запускаем отдельно; Map уже обновлена
        };

        // once выполняет очистку один раз при завершении этого подключения. (автоматически снимает обработчик)
        socket.once("disconnect", unregisterConnection);

        // Если только что стал online - запускаем доставку
        if (!wasOnline) void onPresenceChanged(userId);
    };

    return { registerConnection, isUserOnline };
};
