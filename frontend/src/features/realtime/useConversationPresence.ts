import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";

// Ждём ответ presence:get не больше 5 секунд. Это ожидание ответа, а не срок online-статуса.
const PRESENCE_REQUEST_TIMEOUT_MS = 5000;

type PeerPresence = {
    conversationId: string;
    userId: string;
    isOnline: boolean;
};

type PresenceUpdatedEvent = {
    userId: string;
    isOnline: boolean;
};

type PresenceResponse = { ok: true; presence: PeerPresence } | { ok: false; error: string };

type ConversationPresenceOptions = {
    socketRef: RefObject<Socket | null>;
    conversationId: string | null;
    conversationUserId: string | null;
};

// Получает существующий socket, выбранный чат и id собеседника.
// Запрашивает начальный статус и принимает online/offline из socket-событий.
// Возвращает статус собеседника и обработчики запроса, обновления и сброса.
export const useConversationPresence = ({
    socketRef,
    conversationId,
    conversationUserId,
}: ConversationPresenceOptions) => {
    // содержит актуальные id чата и собеседника
    const selectedConversationRef = useRef({ conversationId, conversationUserId });
    // Запрос, live-обновление и сброс меняют версию; ответ старого запроса пропускаем. (счетчик для проверки актуальности)
    const presenceVersionRef = useRef(0);
    // полученный статус
    const [peerPresence, setPeerPresence] = useState<PeerPresence | null>(null);

    // ------- ЗАПРОС НАЧАЛЬНОГО СТАТУСА -------
    // Вызывается при выборе чата и успешном connect/reconnect.
    // Отправляет presence:get по текущему conversationId и ждёт ack не больше 5 секунд.
    // Сохраняет проверенный ответ, а при ошибке оставляет статус неизвестным.
    const requestPresence = useCallback(() => {
        const socket = socketRef.current;
        const selectedConversation = selectedConversationRef.current;
        if (
            !socket?.connected ||
            !selectedConversation.conversationId ||
            !selectedConversation.conversationUserId
        ) {
            return;
        }

        const requestVersion = ++presenceVersionRef.current;

        // Получает ошибку ожидания либо ответ backend на presence:get.
        // Если сменился чат, соединение или уже пришёл новый статус — пропускает старый ответ.
        // Иначе сохраняет presence для открытого чата; ошибка даёт неизвестный статус.
        const handlePresenceResponse = (requestError: Error | null, response?: PresenceResponse) => {
            if (
                requestVersion !== presenceVersionRef.current ||
                socketRef.current !== socket ||
                !socket.connected
            )
                return;

            if (requestError || !response?.ok) {
                setPeerPresence(null);
                return;
            }

            const presence = response.presence;
            if (
                presence.conversationId !== selectedConversation.conversationId ||
                presence.userId !== selectedConversation.conversationUserId
            )
                return;

            setPeerPresence(presence);
        };

        // Запрос presence:get на backend
        // С timeout первый аргумент callback — ошибка ожидания, второй — ответ sendPresenceResponse с backend.
        socket.timeout(PRESENCE_REQUEST_TIMEOUT_MS).emit(
            "presence:get",
            { conversationId: selectedConversation.conversationId },
            handlePresenceResponse, // вызывается с ответом с backend
        );
    }, [socketRef]);

    // ------- LIVE-ОБНОВЛЕНИЯ СТАТУСА -------
    // Получает presence:updated с userId и признаком online/offline.
    // Принимает только статус собеседника из открытого чата и отменяет применение старого ack.
    // Обновляет состояние, из которого header получает Online или Offline.
    const handlePresenceUpdated = useCallback(
        (event: PresenceUpdatedEvent) => {
            const selectedConversation = selectedConversationRef.current;
            if (
                !socketRef.current?.connected ||
                !selectedConversation.conversationId ||
                event.userId !== selectedConversation.conversationUserId
            )
                return;

            presenceVersionRef.current += 1; // защищает от запоздавшего ответа
            setPeerPresence({
                conversationId: selectedConversation.conversationId,
                userId: event.userId,
                isOnline: event.isOnline,
            });
        },
        [socketRef],
    );

    // ------- СБРОС / СМЕНА ЧАТА -------
    // Вызывается при disconnect (!) , смене чата или уходе со страницы.
    // Делает ожидающие ответы неактуальными и очищает известный статус.
    // Header получает null: потеря нашего соединения не означает, что собеседник offline.
    const resetPresence = useCallback(() => {
        presenceVersionRef.current += 1;
        setPeerPresence(null);
    }, []);

    useEffect(() => {
        selectedConversationRef.current = { conversationId, conversationUserId };
        requestPresence();
        return () => {
            resetPresence();
            selectedConversationRef.current = { conversationId: null, conversationUserId: null };
        };
    }, [conversationId, conversationUserId, requestPresence, resetPresence]);

    return {
        // До cleanup эффекта уже не показываем статус предыдущего чата.
        isPeerOnline:
            peerPresence &&
            peerPresence.conversationId === conversationId &&
            peerPresence.userId === conversationUserId
                ? peerPresence.isOnline
                : null,
        requestPresence,
        handlePresenceUpdated,
        resetPresence,
    };
};
