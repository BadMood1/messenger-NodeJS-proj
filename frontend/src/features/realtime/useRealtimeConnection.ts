import { useEffect } from "react";
import { io } from "socket.io-client";
// Здесь io — клиентская функция создания socket; на backend io — объект, созданный через new Server().

import { SOCKET_URL } from "../../lib/config";
import type { AuthContextValue } from "../auth/auth-context";
import type { Message } from "../messages/messages.api";

// Pick берёт типы двух функций из auth context; & добавляет настройки realtime-хука.
type RealtimeOptions = Pick<AuthContextValue, "getAccessToken" | "resolveAccessTokenAfter401"> & {
    enabled: boolean;
    onMessageCreated: (message: Message) => void;
};

export const useRealtimeConnection = ({
    enabled,
    getAccessToken,
    resolveAccessTokenAfter401,
    onMessageCreated,
}: RealtimeOptions) => {
    useEffect(() => {
        if (!enabled) return;

        let disposed = false; // станет true в cleanup: этот socket больше не нужен
        let refreshing = false; // прямо сейчас ждём результат общего refresh/resolver
        let authRetried = false; // уже пробовали восстановить auth; не запускаем бесконечные retry
        let handshakeToken: string | null = null; // JWT именно последней попытки подключения
        // Соединение принадлежит Messenger, а не выбранному чату.
        const socket = io(SOCKET_URL, {
            autoConnect: false, // сначала регистрируем обработчики, потом вызываем connect()
            // auth ф-ция даёт данные серверу при подключении
            auth: (callback) => {
                handshakeToken = getAccessToken(); // callback выполняется и при reconnect: берём свежий JWT
                callback({ token: handshakeToken }); // отдаём Socket.IO для handshake
            },
        });

        const onConnect = () => {
            authRetried = false; // успешно подключились; будущий отказ снова можно обработать
            if (import.meta.env.DEV) console.debug(`[socket] connected: ${socket.id}`);
        };
        const onDisconnect = (reason: string) => {
            if (import.meta.env.DEV) console.debug(`[socket] disconnected: ${reason}`);
            // Сервер закрывает socket по exp JWT; такой disconnect не запускает auto-reconnect.
            if (reason === "io server disconnect" && !disposed) socket.connect();
        };
        const onConnectError = async (error: Error & { data?: { code?: string } }) => {
            if (import.meta.env.DEV) console.debug(`[socket] connection error: ${error.message}`);
            // Один auth retry на попытку подключения; сетевые ошибки refresh не запускают.
            if (
                error.data?.code !== "UNAUTHORIZED" || // ?. безопасен, если у сетевой ошибки нет data
                !handshakeToken || // нет JWT, который сервер отклонил
                refreshing || // уже обрабатываем другой auth-отказ
                authRetried || // повтор после refresh тоже отклонили — останавливаемся
                disposed // эффект уже завершён
            )
                return;
            refreshing = true; // ставим до await, чтобы параллельный отказ не прошёл проверку
            authRetried = true;
            try {
                // Не создаём второй refresh flow: используем deduplication из AuthProvider.
                const token = await resolveAccessTokenAfter401(handshakeToken); // новый JWT или уже обновлённый REST-запросом
                if (!disposed) { // за время await пользователь мог уйти из Messenger
                    if (token) socket.connect(); // auth callback снова прочитает JWT из Provider
                    else socket.disconnect(); // Неуспешный refresh уже очистил auth в Provider.
                }
            } finally {
                refreshing = false; // ожидание завершилось независимо от результата
            }
        };

        // autoConnect false, чтобы  сначала поставить эти обработчики
        socket.on("connect", onConnect); // соединение установлено
        socket.on("disconnect", onDisconnect); // потеряно или закрыто
        socket.on("connect_error", onConnectError); // попытка подключения не удалась
        socket.on("message:created", onMessageCreated); // передаём сообщение в message hook, state остаётся там

        socket.connect();

        return () => {
            disposed = true; // ожидающий async-код теперь не должен оживлять этот socket
            // Cleanup закрывает и соединение, и reconnect; StrictMode не оставляет лишний socket.
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("connect_error", onConnectError);
            socket.off("message:created", onMessageCreated);
            socket.disconnect(); // закрываем соединение и прекращаем попытки reconnect
        };
    }, [enabled, getAccessToken, resolveAccessTokenAfter401, onMessageCreated]); // выбранный conversation не влияет на соединение
};
