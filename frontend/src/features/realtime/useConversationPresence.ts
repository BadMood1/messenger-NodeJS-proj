import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";

import type { Conversation } from "../conversations/conversations.api";

// Ждём ответ presence:get не больше 5 секунд. Это ожидание ответа, а не срок online-статуса.
const PRESENCE_REQUEST_TIMEOUT_MS = 5000;

export type UserPresence = {
    userId: string;
    isOnline: boolean;
    lastSeenAt: string | null;
};

type PresenceResponse = { ok: true; presence: UserPresence[] } | { ok: false; error: string };

type ConversationPresenceOptions = {
    socketRef: RefObject<Socket | null>;
    conversations: Conversation[];
    conversationUserId: string | null;
};

// Получает существующий socket, список диалогов и id выбранного собеседника.
// Запрашивает начальные статусы и принимает online/offline вместе с lastSeenAt из socket-событий.
// Возвращает общую Map статусов для sidebar, статус открытого собеседника и обработчики.
export const useConversationPresence = ({
    socketRef,
    conversations,
    conversationUserId,
}: ConversationPresenceOptions) => {
    // Запрос и сброс меняют версию; ответ старого запроса пропускаем. (счетчик для проверки актуальности)
    const presenceVersionRef = useRef(0);
    // Пока ждём начальный список, отдельно запоминаем более свежие socket-события.
    const livePresenceRef = useRef(new Map<string, UserPresence>());
    // Для каждого userId храним полученный статус и сохранённое backend время последнего присутствия.
    const [presenceByUserId, setPresenceByUserId] = useState(new Map<string, UserPresence>());
    // Новое сообщение меняет порядок списка, но не должно заново запрашивать presence.
    const conversationIdsKey = conversations.map((conversation) => conversation.id).sort().join(",");

    // ------- ЗАПРОС НАЧАЛЬНОГО СТАТУСА -------
    // Вызывается при изменении набора диалогов и успешном connect/reconnect.
    // Отправляет один presence:get для всех DIRECT-собеседников и ждёт ack не больше 5 секунд.
    // Сохраняет список, не заменяя им более свежие статусы из socket-событий.
    const requestPresence = useCallback(() => {
        const socket = socketRef.current;
        if (!socket?.connected) return;

        const requestVersion = ++presenceVersionRef.current;
        livePresenceRef.current.clear();

        // Получает ошибку ожидания либо ответ backend на presence:get.
        // Если запрос устарел или соединение сменилось — пропускает ответ.
        // Иначе объединяет полученный список с socket-событиями, пришедшими за время ожидания.
        const handlePresenceResponse = (requestError: Error | null, response?: PresenceResponse) => {
            if (
                requestVersion !== presenceVersionRef.current ||
                socketRef.current !== socket ||
                !socket.connected
            )
                return;

            if (requestError || !response?.ok) {
                // Если список не загрузился, доверяем только событиям, полученным после запроса.
                setPresenceByUserId(new Map(livePresenceRef.current));
                return;
            }

            const receivedPresence = new Map(response.presence.map((presence) => [presence.userId, presence]));
            // Если во время запроса пришёл presence:updated, оставляем его вместо старого значения из ответа.
            for (const [userId, presence] of livePresenceRef.current) receivedPresence.set(userId, presence);
            setPresenceByUserId(receivedPresence);
        };

        // Запрос presence:get на backend
        // С timeout первый аргумент callback — ошибка ожидания, второй — ответ sendPresenceResponse с backend.
        socket.timeout(PRESENCE_REQUEST_TIMEOUT_MS).emit(
            "presence:get",
            {},
            handlePresenceResponse, // вызывается с ответом с backend
        );
    }, [socketRef]);

    // ------- LIVE-ОБНОВЛЕНИЯ СТАТУСА -------
    // Получает presence:updated с userId, признаком online/offline и lastSeenAt.
    // Запоминает статус пользователя для sidebar и защищает его от старого ack.
    // Обновляет общую Map: header и список диалогов получают одинаковые данные.
    const handlePresenceUpdated = useCallback(
        (event: UserPresence) => {
            if (!socketRef.current?.connected) return;

            livePresenceRef.current.set(event.userId, event);
            setPresenceByUserId((previousPresence) => {
                const nextPresence = new Map(previousPresence);
                nextPresence.set(event.userId, event);
                return nextPresence;
            });
        },
        [socketRef],
    );

    // ------- СБРОС / ОБНОВЛЕНИЕ СПИСКА ДИАЛОГОВ -------
    // Вызывается при disconnect (!) или уходе со страницы, но не при смене чата.
    // Делает ожидающие ответы неактуальными и очищает известный статус.
    // Header получает null: потеря нашего соединения не означает, что собеседник offline.
    const resetPresence = useCallback(() => {
        presenceVersionRef.current += 1;
        livePresenceRef.current.clear();
        setPresenceByUserId(new Map());
    }, []);

    useEffect(() => {
        requestPresence();
    }, [conversationIdsKey, requestPresence]);

    // И online, и время берём только из записи выбранного собеседника, без отдельного состояния для header.
    const selectedPeerPresence = conversationUserId ? presenceByUserId.get(conversationUserId) : null;

    return {
        presenceByUserId,
        isPeerOnline: selectedPeerPresence?.isOnline ?? null,
        peerLastSeenAt: selectedPeerPresence?.lastSeenAt ?? null,
        requestPresence,
        handlePresenceUpdated,
        resetPresence,
    };
};
