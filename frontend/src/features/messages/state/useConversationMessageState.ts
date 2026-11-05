import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { ClientMessage, Message, MessageDeletedEvent } from "../messages.types";
import { applyKnownMessageChanges } from "./message-state-updates";

type UseConversationMessageStateOptions = {
    conversationId: string | null;
    enabled: boolean;
};

// Получает id выбранного чата и признак авторизации.
// Хранит один список сообщений, версию чата и известные правки/удаления.
// Возвращает state и обработчики обновлений для истории, отправки и realtime.
export const useConversationMessageState = ({ conversationId, enabled }: UseConversationMessageStateOptions) => {
    const [messages, setMessages] = useState<ClientMessage[]>([]);
    const messagesRef = useRef(messages); // текущий список для стабильного обработчика reconnect
    const conversationIdRef = useRef(conversationId); // актуальный ID
    const historyVersionRef = useRef(0);
    // Помним удаления в текущем чате, чтобы запоздавший GET/socket не вернул сообщение или его цитату.
    const deletedMessageIdsRef = useRef(new Set<string>());
    // Хранит правки сообщений
    const editedMessagesRef = useRef(new Map<string, Message>());

    // useLayoutEffect выполняется раньше обычного useEffect — сразу после того, как
    // React применил изменения в DOM, но до того, как браузер покажет кадр.
    useLayoutEffect(() => {
        conversationIdRef.current = conversationId;
        historyVersionRef.current += 1; // отличать старые запросы от актуальных
        deletedMessageIdsRef.current.clear();
        editedMessagesRef.current.clear();
    }, [conversationId]);

    useLayoutEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    // Все ответы и события учитывают уже известные правки и удаления текущего чата.
    // Получает список после GET, socket или подтверждения отправки.
    // Возвращает список с актуальным текстом, цитатами и без известных удалённых сообщений.
    const applyKnownChanges = useCallback(
        (current: ClientMessage[]) =>
            applyKnownMessageChanges(current, editedMessagesRef.current, deletedMessageIdsRef.current),
        [],
    );

    // Получает серверное сообщение после PATCH/socket.
    // Запоминает свежую правку и применяет её к сообщению и его цитатам.
    // Обновляет список; события другого чата и устаревшие правки пропускает.
    const handleMessageUpdated = useCallback(
        (message: Message) => {
            if (!enabled || message.conversationId !== conversationIdRef.current) return;
            if (deletedMessageIdsRef.current.has(message.id)) return; // не удалено ли
            //  Если уже редачили, то более свежая правка не должна быть перезаписана более старой (может задержаться запрос например)
            const previous = editedMessagesRef.current.get(message.id);
            if (previous && Date.parse(previous.updatedAt) > Date.parse(message.updatedAt)) return;

            // Сохраняем правку и во время initial GET/pagination, чтобы их поздний ответ не затёр её.
            editedMessagesRef.current.set(message.id, message);
            setMessages((current) => applyKnownChanges(current)); // применяем правки и удаления к текущим сообщениям
        },
        [enabled, applyKnownChanges],
    );

    // добавл. id в REF, убираем удалённые сообщения и очищает цитаты на них
    // Получает ответ DELETE или socket-событие текущего чата.
    // Запоминает удаление и обновляет единый список сообщений; повторное событие безопасно.
    const handleMessageDeleted = useCallback(
        ({ id, conversationId }: Pick<MessageDeletedEvent, "id" | "conversationId">) => {
            if (!enabled || conversationId !== conversationIdRef.current) return;
            deletedMessageIdsRef.current.add(id);
            editedMessagesRef.current.delete(id);
            // Событие и ответ своего DELETE используют один путь; повторное удаление безопасно.
            setMessages((current) => applyKnownChanges(current));
        },
        [enabled, applyKnownChanges],
    );

    // Получает id сообщений до reconnect-сверки и заново загруженный участок.
    // Помечает отсутствующие в этом участке сообщения удалёнными и убирает их сохранённые правки.
    // Меняет таблицы известных изменений; сам список обновляет вызывающая сверка.
    const rememberMissingMessagesAsDeleted = useCallback((
        serverIdsBeforeReload: ReadonlySet<string>,
        reloadedMessages: Message[],
    ) => {
        const reloadedIds = new Set(reloadedMessages.map((message) => message.id));
        // Если загруженный id отсутствует во всём перечитанном участке — сообщение удалили пока мы были offline.
        for (const id of serverIdsBeforeReload) {
            if (!reloadedIds.has(id)) {
                deletedMessageIdsRef.current.add(id);
                editedMessagesRef.current.delete(id);
            }
        }
    }, []);

    // Получает id входящего серверного сообщения.
    // Проверяет таблицу уже известных удалений текущего чата.
    // Возвращает true, если поздний GET/socket не должен возвращать это сообщение.
    const isMessageDeleted = useCallback((messageId: string) => deletedMessageIdsRef.current.has(messageId), []);

    return {
        messages,
        setMessages,
        messagesRef,
        conversationIdRef,
        historyVersionRef,
        applyKnownChanges,
        isMessageDeleted,
        handleMessageUpdated,
        handleMessageDeleted,
        rememberMissingMessagesAsDeleted,
    };
};
