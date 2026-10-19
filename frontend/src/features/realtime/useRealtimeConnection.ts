import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
// Здесь io — клиентская функция создания socket; на backend io — объект, созданный через new Server().

import { SOCKET_URL } from "../../lib/config";
import type { AuthContextValue } from "../auth/auth-context";
import type { Conversation } from "../conversations/conversations.api";
import type { Message, MessageDeletedEvent } from "../messages/messages.api";
import { useConversationTyping } from "./useConversationTyping";
import { useConversationPresence } from "./useConversationPresence";

// Pick берёт типы двух функций из auth context; & добавляет настройки realtime-хука.
type RealtimeOptions = Pick<AuthContextValue, "getAccessToken" | "resolveAccessTokenAfter401"> & {
    enabled: boolean;
    conversations: Conversation[];
    conversationId: string | null;
    conversationUserId: string | null;
    onMessageCreated: (message: Message) => void;
    onMessageUpdated: (message: Message) => void;
    onMessageDeleted: (message: MessageDeletedEvent) => void;
    onConnected: () => void;
};

export const useRealtimeConnection = ({
    enabled,
    conversations,
    conversationId,
    conversationUserId,
    getAccessToken,
    resolveAccessTokenAfter401,
    onMessageCreated,
    onMessageUpdated,
    onMessageDeleted,
    onConnected,
}: RealtimeOptions) => {
    // Один socket для сообщений, typing и presence.
    const socketRef = useRef<Socket | null>(null);

    // ------- TYPING НА СУЩЕСТВУЮЩЕМ СОЕДИНЕНИИ -------
    const { isPeerTyping, notifyTyping, stopTyping, handleTyping, resetTyping } = useConversationTyping({
        socketRef,
        conversationId,
        conversationUserId,
    });

    // ------- PRESENCE НА СУЩЕСТВУЮЩЕМ СОЕДИНЕНИИ -------
    const { presenceByUserId, isPeerOnline, peerLastSeenAt, requestPresence, handlePresenceUpdated, resetPresence } =
        useConversationPresence({
            socketRef,
            conversations,
            conversationUserId,
        });

    // ------- ПОДКЛЮЧЕНИЕ И AUTH -------
    useEffect(() => {
        if (!enabled) return;

        let disposed = false; // флаг "это соединение больше не используем"
        let refreshing = false; // прямо сейчас ждём результат общего refresh/resolver
        let authRetried = false; // уже пробовали восстановить auth; не запускаем бесконечные retry
        let handshakeToken: string | null = null; // JWT именно последней попытки подключения
        let lastSentActivity: boolean | null = null; // не отправляем одинаковые focus/visibility-события подряд
        // Соединение принадлежит Messenger, а не выбранному чату.

        const socket = io(SOCKET_URL, {
            autoConnect: false, // сначала регистрируем обработчики, потом вызываем connect()
            // auth ф-ция даёт данные серверу при подключении
            auth: (callback) => {
                handshakeToken = getAccessToken(); // callback выполняется и при reconnect: берём свежий JWT
                callback({
                    token: handshakeToken,
                    isActive: !document.hidden && document.hasFocus(),
                }); // отдаём Socket.IO для handshake, в том числе при reconnect
            },
        });
        socketRef.current = socket; // typing и presence используют этот же socket, второго соединения нет

        // Вызывается при connect, focus, blur и смене видимости вкладки.
        // Передаёт её активность при изменении; при уходе также останавливает собственный typing.
        // Соединение оставляет открытым: сообщения продолжают приходить в фоне.
        const reportActivity = () => {
            if (disposed || !socket.connected) return;
            const isActive = !document.hidden && document.hasFocus();
            if (!isActive) stopTyping();
            if (lastSentActivity === isActive) return;

            lastSentActivity = isActive;
            socket.emit("presence:activity", { isActive });
        };

        const onConnect = () => {
            authRetried = false; // успешно подключились; будущий отказ снова можно обработать
            lastSentActivity = null; // новое соединение должно получить активность, даже если она не менялась
            reportActivity(); // фокус мог измениться, пока ждали handshake
            requestPresence(); // после reconnect запрашиваем статус заново: события могли быть пропущены
            // connect срабатывает и после reconnect: REST сверит события, пропущенные без соединения.
            // Первый connect тоже важен: initial GET мог закончиться до подключения socket.
            onConnected();
            if (import.meta.env.DEV) console.debug(`[socket] connected: ${socket.id}`);
        };
        const onDisconnect = (reason: string) => {
            resetTyping(); // после разрыва старый typing не должен оставаться в UI
            resetPresence(); // статусы собеседников неизвестны, пока наше соединение не восстановится
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
                if (!disposed) {
                    // за время await пользователь мог уйти из Messenger
                    if (token)
                        socket.connect(); // auth callback снова прочитает JWT из Provider
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
        socket.on("message:updated", onMessageUpdated); // меняем текст и цитаты без повторного GET
        socket.on("message:deleted", onMessageDeleted); // передаём id в тот же hook; новый GET не нужен
        socket.on("conversation:typing", handleTyping); // backend добавил userId, typing hook проверит выбранный чат
        socket.on("presence:updated", handlePresenceUpdated); // общая Map обновит и sidebar, и header

        window.addEventListener("focus", reportActivity); // вернулся в окно
        window.addEventListener("blur", reportActivity); // окно потеряло фокус
        document.addEventListener("visibilitychange", reportActivity); // вкладка скрылась / открылась
        socket.connect();

        return () => {
            disposed = true; // ожидающий async-код теперь не должен оживлять этот socket
            resetTyping(); // пока соединение открыто, сообщаем об остановке собственного набора
            resetPresence(); // поздний ack не должен обновлять состояние после ухода со страницы
            window.removeEventListener("focus", reportActivity);
            window.removeEventListener("blur", reportActivity);
            document.removeEventListener("visibilitychange", reportActivity);
            // Cleanup закрывает и соединение, и reconnect; StrictMode не оставляет лишний socket.
            socket.off("connect", onConnect);
            socket.off("disconnect", onDisconnect);
            socket.off("connect_error", onConnectError);
            socket.off("message:created", onMessageCreated);
            socket.off("message:updated", onMessageUpdated);
            socket.off("message:deleted", onMessageDeleted);
            socket.off("conversation:typing", handleTyping);
            socket.off("presence:updated", handlePresenceUpdated);
            socket.disconnect(); // закрываем соединение и прекращаем попытки reconnect
            socketRef.current = null;
        };
    }, [
        enabled,
        getAccessToken,
        resolveAccessTokenAfter401,
        onMessageCreated,
        onMessageUpdated,
        onMessageDeleted,
        onConnected,
        handleTyping,
        resetTyping,
        stopTyping,
        requestPresence,
        handlePresenceUpdated,
        resetPresence,
    ]); // выбранный conversation не влияет на соединение

    return { isPeerTyping, notifyTyping, stopTyping, presenceByUserId, isPeerOnline, peerLastSeenAt };
};
