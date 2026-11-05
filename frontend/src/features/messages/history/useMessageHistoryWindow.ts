import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { RequestRetryState } from "../../../lib/request-retry";
import type { Message, MessageHistoryCursor } from "../messages.types";

type HistoryCursors = {
    olderCursor: MessageHistoryCursor | null;
    newerCursor: MessageHistoryCursor | null;
};

// Получает id выбранного чата.
// Хранит общие курсоры, буферы socket-событий и контроллеры всех загрузок истории.
// Возвращает одно окно для initial load, pagination и reconnect; при смене чата сбрасывает его refs.
export const useMessageHistoryWindow = (conversationId: string | null) => {
    // Показывает, какому чату принадлежат сообщ-я, находящиеся сейчас в messages.
    // Чтобы не показывать с другого чата при смене его
    const [historyConversationId, setHistoryConversationId] = useState<string | null>(null);
    const initialLoadingRef = useRef(true);
    const hasLoadedHistoryRef = useRef(false);
    // initial ждёт повтор
    const [initialRetry, setInitialRetry] = useState<RequestRetryState | null>(null);
    const [historySyncRetry, setHistorySyncRetry] = useState<RequestRetryState | null>(null);
    const initialRetryRef = useRef<RequestRetryState | null>(null);
    const historySyncRetryRef = useRef<RequestRetryState | null>(null);
    const receivedDuringLoadRef = useRef<Message[]>([]); // события, пришедшие пока initial GET ещё ждёт ответа
    // контроллер сверки истории после reconnect
    const historySyncControllerRef = useRef<AbortController | null>(null);

    // ------- ГРАНИЦЫ ОКНА И ЗАГРУЗКА СТРАНИЦ -------
    // Курсоры не рисуем: используем их только для следующих запросов.
    // State сообщает UI, есть ли продолжение истории; ref даёт запросам актуальные границы сразу.
    const [historyCursors, setCursorState] = useState<HistoryCursors>({ olderCursor: null, newerCursor: null });
    const historyCursorsRef = useRef(historyCursors);

    // Получает новые границы загруженного окна.
    // Обновляет ref для запросов и state для признаков продолжения истории в UI.
    // Сохраняет одинаковые курсоры в обоих представлениях без чтения ref во время render.
    const setHistoryCursors = useCallback((nextCursors: HistoryCursors) => {
        historyCursorsRef.current = nextCursors;
        setCursorState(nextCursors);
    }, []);
    // ID сообщения, перед которым рисуем Unread messages.
    const [firstUnreadMessageId, setFirstUnreadMessageId] = useState<string | null>(null);
    // Новые socket-сообщения ждут, пока догрузим промежуток до конца переписки.
    const deferredMessagesRef = useRef(new Map<string, Message>());
    // Намерение перейти к концу переписки после собственной отправки.
    const latestWindowRequestedRef = useRef(false);

    // контроллер запроса следующей страницы вверх/вниз
    const paginationControllerRef = useRef<AbortController | null>(null); // отменяет страницу и не даёт запустить две одновременно

    // useLayoutEffect выполняется раньше обычного useEffect — сразу после того, как
    // React применил изменения в DOM, но до того, как браузер покажет кадр.

    useLayoutEffect(() => {
        initialLoadingRef.current = true;
        hasLoadedHistoryRef.current = false;
        initialRetryRef.current = null;
        historySyncRetryRef.current = null;
        receivedDuringLoadRef.current = []; // события предыдущего чата больше не нужны
        historyCursorsRef.current = { olderCursor: null, newerCursor: null };
        deferredMessagesRef.current.clear();
        latestWindowRequestedRef.current = false;
    }, [conversationId]);

    return {
        historyConversationId, setHistoryConversationId,
        initialLoadingRef, hasLoadedHistoryRef,
        initialRetry, setInitialRetry, initialRetryRef,
        historySyncRetry, setHistorySyncRetry, historySyncRetryRef,
        receivedDuringLoadRef,
        historySyncControllerRef, paginationControllerRef,
        historyCursors, setHistoryCursors, historyCursorsRef, deferredMessagesRef, latestWindowRequestedRef,
        firstUnreadMessageId, setFirstUnreadMessageId,
    };
};
