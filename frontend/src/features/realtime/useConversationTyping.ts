import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Socket } from "socket.io-client";

// Порог для повторного true при вводе текста. Это сравнение времени, а не отдельный таймер.
const TYPING_INTERVAL_MS = 2000;
// Отправитель: через 1,5 секунды после последнего изменения input отправляем false.
const TYPING_IDLE_MS = 1500;
// Получатель: через 6 секунд после последнего принятого true сами скрываем индикатор.
// Обычно он исчезает раньше по false; этот таймер нужен, если остановка потерялась.
const TYPING_EXPIRE_MS = 6000;

// БЭКЭНД 5 секунд - от последнего принятого и разрешенного true этого socket

type ConversationTypingEvent = {
    conversationId: string;
    userId: string;
    isTyping: boolean;
};

type OutgoingTyping = {
    conversationId: string;
    lastSentAt: number; // время последнего отправленного true, не последнего изменения input
    timeout: ReturnType<typeof setTimeout>; // id таймера паузы нашего ввода на 1,5 секунды
};

type ConversationTypingOptions = {
    socketRef: RefObject<Socket | null>;
    conversationId: string | null;
    conversationUserId: string | null;
};

// Получает существующий socket, выбранный чат и id собеседника.
// Отправляет typing с паузами и хранит временный статус собеседника.
// Возвращает индикатор и обработчики набора, остановки и socket-событий.
export const useConversationTyping = ({
    socketRef,
    conversationId,
    conversationUserId,
}: ConversationTypingOptions) => {
    // актуальный открытый чат и собеседник
    const selectedConversationRef = useRef({ conversationId, conversationUserId });
    // сведения о нашем активном наборе текста
    const outgoingTypingRef = useRef<OutgoingTyping | null>(null);
    // таймер который уберёт typing собеседника, если stop-событие потерялось
    const incomingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // состояние индикатора набора собеседника; useState, чтобы React перерисовал компонент
    const [receivedTyping, setReceivedTyping] = useState<ConversationTypingEvent | null>(null);

    // ------- ОТПРАВКА TYPING -------

    // Вызывается после паузы, отправки сообщения или ухода из composer.
    // Отменяет таймер и сообщает серверу об остановке этого подключения.
    // Очищает локальный статус; повторный вызов ничего не отправляет.
    const stopTyping = useCallback(() => {
        const outgoingTyping = outgoingTypingRef.current;
        if (!outgoingTyping) return;

        // Если остановились раньше 1,5 секунды (например, нажали Send), отменяем запланированный вызов.
        // clearTimeout только отменяет таймер — сам stopTyping он не вызывает.
        clearTimeout(outgoingTyping.timeout);
        outgoingTypingRef.current = null;
        if (socketRef.current?.connected) {
            socketRef.current.volatile.emit("conversation:typing", {
                conversationId: outgoingTyping.conversationId,
                isTyping: false,
            });
        }
    }, [socketRef]);

    // Вызывается при изменении текста
    // Отправляет начало набора не чаще раза в 2 секунды и продлевает таймер паузы.
    // После 1,5 секунды без изменений вызывает stopTyping.
    const notifyTyping = useCallback(
        (content: string) => {
            const socket = socketRef.current;
            const selectedConversationId = selectedConversationRef.current.conversationId;

            if (!socket?.connected || !selectedConversationId || !content.trim()) {
                stopTyping();
                return;
            }

            // берём предыдущее сост.
            const outgoingTyping = outgoingTypingRef.current;
            const now = Date.now();
            // отменяем таймер остановки при изменении (ниже создастся новый)
            // Даже если true сейчас не отправим, новый ввод начинает отсчёт паузы заново.
            if (outgoingTyping) clearTimeout(outgoingTyping.timeout);

            let lastSentAt = outgoingTyping?.lastSentAt ?? 0;
            // если набора раньше не было - отправляем сразу; если был - не чаще раза в 2 секунды
            // Условие проверяется при вводе: автоматически каждые 2 секунды здесь ничего не запускается.
            if (!outgoingTyping || now - lastSentAt >= TYPING_INTERVAL_MS) {
                // volatile позволяет отбросить событие, если подключение сейчас не готово его отправить
                //  т.е. не копит старые typing-события для отправки после reconnect.
                socket.volatile.emit("conversation:typing", {
                    conversationId: selectedConversationId,
                    isTyping: true,
                });
                lastSentAt = now;
            }

            outgoingTypingRef.current = {
                conversationId: selectedConversationId,
                lastSentAt,
                // таймер остановки набора через 1,5
                // Если нового ввода не будет, вызовется frontend stopTyping и отправит false на backend.
                // Если ввод будет, следующий notifyTyping отменит этот таймер и создаст новый.
                timeout: setTimeout(stopTyping, TYPING_IDLE_MS),
            };
        },
        [socketRef, stopTyping],
    );

    // ------- ПРИЁМ TYPING -------
    // ПОЛУЧАЕТ typing-событие от backend с автором и id чата.
    // Применяет его только к собеседнику в открытом чате и обновляет таймер.
    // Показывает индикатор или убирает его при false либо через 6 секунд без событий.
    const handleTyping = useCallback(
        (event: ConversationTypingEvent) => {
            const selectedConversation = selectedConversationRef.current;
            if (
                !socketRef.current?.connected ||
                event.conversationId !== selectedConversation.conversationId ||
                event.userId !== selectedConversation.conversationUserId
            )
                return;

            // старый таймер сбрасываем
            // Отменяем прежнее скрытие индикатора: true ниже даст новые 6 секунд, false уберёт его сразу.
            if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
            incomingTimeoutRef.current = null;
            // обновл. state
            setReceivedTyping(event.isTyping ? event : null);

            // ----- обрабатываем новый таймер
            if (event.isTyping) {
                // Если stop-событие потерялось, индикатор всё равно исчезнет по локальному таймеру.
                // Эти 6 секунд считаются от полученного true, а не от последнего нажатия у собеседника.
                // Здесь только скрываем свой UI; никаких событий на backend не отправляем.
                incomingTimeoutRef.current = setTimeout(() => {
                    incomingTimeoutRef.current = null;
                    setReceivedTyping(null);
                }, TYPING_EXPIRE_MS);
            }
        },
        [socketRef],
    );

    // ------- ОЧИСТКА ПРИ СМЕНЕ ЧАТА / DISCONNECT -------
    // Вызывается при смене чата, отключении socket или уходе со страницы.
    // Останавливает собственный typing и отменяет таймер собеседника.
    // Убирает индикатор и оставляет новое соединение без старого typing-статуса.
    const resetTyping = useCallback(() => {
        stopTyping();
        // Старый таймер собеседника больше не нужен после смены чата или disconnect.
        if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
        incomingTimeoutRef.current = null;
        setReceivedTyping(null);
    }, [stopTyping]);

    // отвечает за выбранный чат
    useEffect(() => {
        selectedConversationRef.current = { conversationId, conversationUserId };
        return () => {
            // Сначала остановка старого чата; следующий effect запишет новый выбранный чат.
            resetTyping();
            selectedConversationRef.current = { conversationId: null, conversationUserId: null };
        };
    }, [conversationId, conversationUserId, resetTyping]);

    useEffect(() => {
        // Получает событие смены видимости вкладки.
        // Если пользователь ушёл из вкладки, останавливает её typing.
        // Собеседник перестаёт видеть набор от этого подключения.
        const stopTypingWhenHidden = () => {
            if (document.hidden) stopTyping();
        };

        // если скрыли вкладку, то stopTyping
        document.addEventListener("visibilitychange", stopTypingWhenHidden);
        return () => document.removeEventListener("visibilitychange", stopTypingWhenHidden);
    }, [stopTyping]);

    return {
        // Проверка id сразу скрывает статус старого чата, ещё до cleanup эффекта.
        isPeerTyping: Boolean(
            receivedTyping &&
            receivedTyping.conversationId === conversationId &&
            receivedTyping.userId === conversationUserId,
        ),
        notifyTyping,
        stopTyping,
        handleTyping,
        resetTyping,
    };
};
