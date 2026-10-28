import { useCallback, useLayoutEffect, useRef } from "react";

import type { ClientMessage } from "./messages.api";

// Только DOM и позиция скролла: сообщения и запросы остаются в useConversationMessages.
export const useMessageScrollPosition = (messages: ClientMessage[]) => {
    const messagesContainerRef = useRef<HTMLDivElement | null>(null); // DOM-эл списка сообщений
    // Одноразовый флаг для прокрутки вниз после initial load, не после pagination.
    const shouldScrollToBottomRef = useRef(false);
    const scrollTargetMessageIdRef = useRef<string | null>(null);
    // Снимок перед prepend или сверкой истории: сохраняем видимое сообщение и его положение на экране.
    const prependScrollRef = useRef<{
        anchors: { element: HTMLElement; offset: number }[];
        scrollHeight: number;
        scrollTop: number;
    } | null>(null);

    const scrollToBottomAfterUpdate = useCallback(() => {
        // Сейчас ставим флаг; прокручиваем после обновления DOM в useLayoutEffect ниже.
        shouldScrollToBottomRef.current = true;
        scrollTargetMessageIdRef.current = null;
    }, []);

    // Получает id первого непрочитанного сообщения из начального ответа.
    // Запоминает цель, чтобы прокрутить к ней после появления сообщений в DOM.
    // Меняет только следующую позицию скролла; сообщения не помечает прочитанными.
    const scrollToMessageAfterUpdate = useCallback((messageId: string) => {
        scrollTargetMessageIdRef.current = messageId;
        shouldScrollToBottomRef.current = false;
    }, []);

    const isNearBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        return Boolean(
            container && container.scrollHeight - container.scrollTop - container.clientHeight < 80,
        );
    }, []);

    const isNearTop = useCallback(() => {
        const container = messagesContainerRef.current;
        return Boolean(container && container.scrollTop <= 80);
    }, []);

    const resetScrollPosition = useCallback(() => {
        // Новый чат должен дождаться собственной первой страницы перед прокруткой вниз.
        shouldScrollToBottomRef.current = false;
        scrollTargetMessageIdRef.current = null;
        // Снимок старого чата больше не нужен.
        prependScrollRef.current = null;
    }, []);

    const clearPrependScrollSnapshot = useCallback(() => {
        prependScrollRef.current = null;
    }, []);

    const saveScrollBeforeUpdate = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const { top, bottom } = container.getBoundingClientRect();
        const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"));
        const firstVisibleIndex = elements.findIndex((element) => {
            const rect = element.getBoundingClientRect();
            return rect.bottom > top && rect.top < bottom;
        });
        // Если видимый якорь удалили, пробуем следующие сообщения, затем предыдущие — не всю разницу высот.
        const candidates =
            firstVisibleIndex < 0
                ? elements
                : [...elements.slice(firstVisibleIndex), ...elements.slice(0, firstVisibleIndex).reverse()];
        prependScrollRef.current = {
            anchors: candidates.map((element) => ({
                element,
                offset: element.getBoundingClientRect().top - top,
            })),
            scrollHeight: container.scrollHeight,
            scrollTop: container.scrollTop,
        };
    }, []);

    // Выставляем нужную позицию до отрисовки кадра, чтобы скролл не прыгал.
    useLayoutEffect(() => {
        const container = messagesContainerRef.current;

        if (!container) {
            return;
        }

        // ------- ПЕРВОЕ ОТКРЫТИЕ ВОЗЛЕ НЕПРОЧИТАННОГО -------
        if (scrollTargetMessageIdRef.current) {
            const targetId = scrollTargetMessageIdRef.current;
            // находим элемент сообщения
            const target = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).find(
                (element) => element.dataset.messageId === targetId,
            );
            const separator = container.querySelector<HTMLElement>("[data-unread-separator]");
            const anchor = separator ?? target;

            // Ставим разделитель у верхнего края, а не внизу окна.
            // Если сообщение уже удалили, остаёмся в начале загруженного участка.
            container.scrollTop = anchor
                ? container.scrollTop +
                  anchor.getBoundingClientRect().top -
                  container.getBoundingClientRect().top -
                  12
                : 0;
            scrollTargetMessageIdRef.current = null;
            prependScrollRef.current = null;
            return;
        }

        // После initial load DOM уже знает полную высоту первой страницы.
        if (shouldScrollToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            // Следующие изменения messages не должны снова переносить пользователя вниз.
            shouldScrollToBottomRef.current = false;
            prependScrollRef.current = null;
            return;
        }

        const previousScroll = prependScrollRef.current;

        if (!previousScroll) {
            return;
        }

        const survivingAnchor = previousScroll.anchors.find(({ element }) => container.contains(element));
        if (survivingAnchor) {
            // Возвращаем то же сообщение на ту же высоту, даже если у bubbles разные размеры.
            const currentOffset =
                survivingAnchor.element.getBoundingClientRect().top - container.getBoundingClientRect().top;
            container.scrollTop += currentOffset - survivingAnchor.offset;
        } else {
            // Запасной вариант, если ни одно сообщение старого списка не сохранилось.
            container.scrollTop =
                previousScroll.scrollTop + (container.scrollHeight - previousScroll.scrollHeight);
        }
        prependScrollRef.current = null;
    }, [messages]);

    return {
        messagesContainerRef,
        scrollToBottomAfterUpdate,
        scrollToMessageAfterUpdate,
        isNearBottom,
        isNearTop,
        resetScrollPosition,
        saveScrollBeforeUpdate,
        clearPrependScrollSnapshot,
    };
};
