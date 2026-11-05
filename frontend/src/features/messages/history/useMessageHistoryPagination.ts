import { useCallback, useEffect, useState } from "react";

import type { AuthenticatedRequest } from "../../auth/authenticated-request";
import { requestWithRetry, type RequestRetryState } from "../../../lib/request-retry";
import { getMessages } from "../messages.api";
import type { ClientMessage, MessageHistoryCursor } from "../messages.types";
import { mergeMessage, reconcileMessageHistory } from "../state/message-state-updates";
import type { useConversationMessageState } from "../state/useConversationMessageState";
import type { useMessageScrollPosition } from "../scroll/useMessageScrollPosition";
import type { useMessageHistoryWindow } from "./useMessageHistoryWindow";

type HistoryPageDirection = "older" | "newer" | "latest";
type UseMessageHistoryPaginationOptions = {
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
    messageState: ReturnType<typeof useConversationMessageState>;
    historyWindow: ReturnType<typeof useMessageHistoryWindow>;
    scroll: ReturnType<typeof useMessageScrollPosition>;
    messagesLoading: boolean;
};

// Получает общий state, окно истории и текущую геометрию scroll.
// Загружает older/newer/latest, сохраняя позицию и общий запрет параллельных GET.
// Возвращает состояние pagination, Retry и команды прокрутки/перехода к концу.
export const useMessageHistoryPagination = ({
    enabled, authenticatedRequest, messageState, historyWindow, scroll, messagesLoading,
}: UseMessageHistoryPaginationOptions) => {
    const {
        messages, setMessages, messagesRef,
        conversationIdRef, historyVersionRef, applyKnownChanges,
    } = messageState;
    const {
        historyConversationId, initialLoadingRef, historyCursorsRef, setHistoryCursors, deferredMessagesRef,
        latestWindowRequestedRef, paginationControllerRef, historySyncControllerRef,
        historySyncRetryRef, setHistorySyncRetry, setFirstUnreadMessageId,
    } = historyWindow;
    const {
        isNearBottom, isNearTop, scrollToBottom, scrollToBottomAfterUpdate,
        saveScrollBeforeUpdate, clearPrependScrollSnapshot, updateIsScrolledAwayFromBottom,
    } = scroll;
    // Что сейчас загружаем: older, newer, latest либо ничего — null.
    const [loadingDirection, setLoadingDirection] = useState<HistoryPageDirection | null>(null);
    const [paginationError, setPaginationError] = useState<{
        direction: HistoryPageDirection;
        message: string;
    } | null>(null);
    // Загрузка страницы вверх/вниз или последних сообщений ждёт повтор
    const [paginationRetry, setPaginationRetry] = useState<RequestRetryState | null>(null);

    // ------- ПРОДОЛЖЕНИЕ ИСТОРИИ В ОБЕ СТОРОНЫ -------
    // Получает направление: старее, новее или последнее окно по кнопке/после отправки.
    // Загружает одну страницу, объединяет сообщения и обновляет только затронутую границу.
    // Сохраняет видимое сообщение; устаревший ответ другого чата не применяет.
    const loadHistoryPage = useCallback(
        async (direction: HistoryPageDirection) => {
            const currentConversationId = conversationIdRef.current;
            if (
                !enabled ||
                !currentConversationId ||
                initialLoadingRef.current ||
                historyConversationId !== currentConversationId
            )
                return;

            let cursor: MessageHistoryCursor | null = null;
            if (direction === "older") cursor = historyCursorsRef.current.olderCursor;
            if (direction === "newer") cursor = historyCursorsRef.current.newerCursor;
            // запружаем вверх или вниз, но соотв. курсора нет - продолжать в эту сторону нечего
            if (direction !== "latest" && !cursor) return;
            // Защита от параллельной загрузки, при загрузке другой стр. или reconnect-сверке - ждём завершения
            if (
                direction !== "latest" &&
                (paginationControllerRef.current || historySyncControllerRef.current)
            )
                return;

            // если переход к концу уже запрошен и его страница ещё загружается - не запускаем повторный GET
            if (direction === "latest" && latestWindowRequestedRef.current && paginationControllerRef.current)
                return;

            // Подготавливаем переход к концу
            if (direction === "latest") {
                latestWindowRequestedRef.current = true; // намерение открыть конец чата
                paginationControllerRef.current?.abort(); // отменяем выполняющуюся страницу старого участка
                historySyncControllerRef.current?.abort(); // отменяем сверку старую
                historySyncControllerRef.current = null;
                historySyncRetryRef.current = null;
                setHistorySyncRetry(null);
            }
            const controller = new AbortController();
            paginationControllerRef.current = controller;
            const historyVersion = historyVersionRef.current;
            const serverIdsBeforeRequest = new Set(
                // берём актуальные сообщения, исключ. локальные sending/failed, берём ID
                messagesRef.current.filter((message) => !message.localStatus).map((message) => message.id),
            );

            // проверка актуальности ответа
            // true, если запрос не отменили, открыт тот же чат, версия истории осталась прежней
            const isCurrent = () =>
                !controller.signal.aborted &&
                conversationIdRef.current === currentConversationId &&
                historyVersionRef.current === historyVersion;
            setLoadingDirection(direction);
            setPaginationError(null);
            setPaginationRetry(null);

            try {
                const result = await requestWithRetry(
                    () =>
                        getMessages(currentConversationId, authenticatedRequest, {
                            cursor: cursor?.id,
                            cursorCreatedAt: cursor?.createdAt,
                            direction: direction === "latest" ? undefined : direction,
                            signal: controller.signal,
                        }),
                    {
                        signal: controller.signal,
                        onRetryState: (state) => {
                            if (isCurrent()) setPaginationRetry(state);
                        },
                    },
                );
                // проверяем, чтобы запрос не устарел за время ожидания
                if (!isCurrent()) return;

                // За время запроса пользователь мог прокрутить дальше или отправить сообщение.
                // Поэтому снимаем текущую геометрию только сейчас, перед изменением messages.
                if (direction === "latest") scrollToBottomAfterUpdate();
                else saveScrollBeforeUpdate();

                // дошли ли до конца
                const reachedLatest = direction !== "older" && !result.newerCursor;
                // если дошли до конца, копируем накопленные отложенные сообщения из Map в массив
                const deferredMessages = reachedLatest ? [...deferredMessagesRef.current.values()] : [];
                if (reachedLatest) deferredMessagesRef.current.clear();
                // обновл. messages
                setMessages((currentMessages) => {
                    // Собранный список сообщений для отображения, пока без добавления отложенных
                    const merged =
                        direction === "latest"
                            ? // заменяем старое окно
                              reconcileMessageHistory(
                                  currentMessages,
                                  result.messages,
                                  serverIdsBeforeRequest,
                              )
                            : // при older/newer дополняем существующий список
                              // допустим currentMessages содержит №71-100, а result.messages содержит №101 и №102
                              // берём #101, вызываем mergeMessage(currentMessages, #101); mergeMessage(массив71–101, сообщение102)
                              result.messages.reduce<ClientMessage[]>(mergeMessage, currentMessages);
                    // reduce подмешивает deferred messages в merged. Применяем все изменения
                    return applyKnownChanges(deferredMessages.reduce<ClientMessage[]>(mergeMessage, merged));
                });

                // --- Обновление курсоров ---
                const updatedCursors = { ...historyCursorsRef.current };
                if (direction !== "newer") updatedCursors.olderCursor = result.olderCursor;
                if (direction !== "older") updatedCursors.newerCursor = result.newerCursor;
                setHistoryCursors(updatedCursors);
                if (direction === "latest") {
                    latestWindowRequestedRef.current = false;
                    setFirstUnreadMessageId(null);
                }
            } catch (requestError) {
                if (isCurrent()) {
                    setPaginationError({
                        direction,
                        message:
                            requestError instanceof Error ? requestError.message : "Failed to load messages",
                    });
                    // убирает сохраненный снимок скролла, чтобы он не применился к след. обновлению
                    clearPrependScrollSnapshot();
                }
            } finally {
                // Старый запрос не должен сбрасывать loading нового запроса.
                if (paginationControllerRef.current === controller) {
                    paginationControllerRef.current = null;
                    setLoadingDirection(null);
                }
            }
        },
        [
            enabled,
            historyConversationId,
            authenticatedRequest,
            applyKnownChanges,
            scrollToBottomAfterUpdate,
            saveScrollBeforeUpdate,
            clearPrependScrollSnapshot,
            conversationIdRef,
            historyVersionRef,
            messagesRef,
            setMessages,
            initialLoadingRef, historyCursorsRef, deferredMessagesRef,
            latestWindowRequestedRef, paginationControllerRef, historySyncControllerRef,
            historySyncRetryRef, setHistorySyncRetry, setFirstUnreadMessageId,
            setHistoryCursors,
        ],
    );

    // Вызывается по кнопке перехода к последним сообщениям открытого чата.
    // Если конец ещё не загружен — запрашивает последнее окно, иначе плавно прокручивает DOM.
    // Использует существующие загрузку и защиту от устаревших ответов; прочтение не меняет.
    const scrollToLatestMessages = () => {
        if (!enabled || initialLoadingRef.current || historyConversationId !== conversationIdRef.current)
            return;
        if (historyCursorsRef.current.newerCursor) void loadHistoryPage("latest");
        else scrollToBottom();
    };

    // Получает scroll-событие контейнера сообщений из ChatPanel.
    // У нужного края запрашивает страницу, если соответствующий cursor ещё существует.
    // Ничего не запускает повторно при активном запросе или ошибке до Retry.
    const handleMessagesScroll = () => {
        updateIsScrolledAwayFromBottom();
        if (paginationError) return;
        if (isNearBottom() && historyCursorsRef.current.newerCursor) void loadHistoryPage("newer");
        else if (isNearTop()) void loadHistoryPage("older");
    };

    // Получает текущее направление неудачной загрузки из state.
    // Повторяет тот же запрос после нажатия Retry.
    // При успехе убирает ошибку и дополняет историю обычным путём.
    const retryHistoryPage = () => {
        if (paginationError) void loadHistoryPage(paginationError.direction);
    };

    // Автоматическая дозагрузка сообщений вниз, но даже если user не скроллил
    // Новые сообщ. появились на экране? Тогда effect чекает мы всё ещё близко к низу? Если да - загружает ещё
    // Например экран вмещает 50 сообщ, а получили только 30, handleMessagesScroll без скролла не вызовется, тут и работает эффект
    useEffect(() => {
        if (
            !messagesLoading &&
            !loadingDirection &&
            !paginationError &&
            isNearBottom() &&
            historyCursorsRef.current.newerCursor
        )
            void loadHistoryPage("newer");
    }, [
        messages, messagesLoading, loadingDirection, paginationError,
        isNearBottom, loadHistoryPage, historyCursorsRef,
    ]);

    // Вызывается после добавления optimistic-сообщения или Retry.
    // Если конец переписки ещё не загружен, запускает существующий переход latest.
    // Сохраняет общую отмену pagination/reconnect и не создаёт отдельный запрос отправки.
    const requestLatestWindowForSend = () => {
        if (historyCursorsRef.current.newerCursor) void loadHistoryPage("latest");
    };

    return {
        loadingDirection, setLoadingDirection,
        paginationError, setPaginationError,
        paginationRetry, setPaginationRetry,
        scrollToLatestMessages, handleMessagesScroll, retryHistoryPage,
        requestLatestWindowForSend,
    };
};
