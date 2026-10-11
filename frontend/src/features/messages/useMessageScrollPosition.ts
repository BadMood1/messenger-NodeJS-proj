import { useCallback, useLayoutEffect, useRef } from "react";

import type { ClientMessage } from "./messages.api";

// Только DOM и позиция скролла: сообщения и запросы остаются в useConversationMessages.
export const useMessageScrollPosition = (messages: ClientMessage[]) => {
    const messagesContainerRef = useRef<HTMLDivElement | null>(null); // DOM-эл списка сообщений
    // Одноразовый флаг для прокрутки вниз после initial load, не после pagination.
    const shouldScrollToBottomRef = useRef(false);
    // Снимок прямо перед prepend: сохраняем видимое сообщение и его положение на экране.
    const prependScrollRef = useRef<{
        anchor: HTMLElement | null;
        offset: number;
        scrollHeight: number;
        scrollTop: number;
    } | null>(null);

    const scrollToBottomAfterUpdate = useCallback(() => {
        // Сейчас ставим флаг; прокручиваем после обновления DOM в useLayoutEffect ниже.
        shouldScrollToBottomRef.current = true;
    }, []);

    const isNearBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        return Boolean(container && container.scrollHeight - container.scrollTop - container.clientHeight < 80);
    }, []);

    const isNearTop = useCallback(() => {
        const container = messagesContainerRef.current;
        return Boolean(container && container.scrollTop <= 80);
    }, []);

    const resetScrollPosition = useCallback(() => {
        // Новый чат должен дождаться собственной первой страницы перед прокруткой вниз.
        shouldScrollToBottomRef.current = false;
        // Снимок старого чата больше не нужен.
        prependScrollRef.current = null;
    }, []);

    const clearPrependScrollSnapshot = useCallback(() => {
        prependScrollRef.current = null;
    }, []);

    const saveScrollBeforePrepend = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const { top, bottom } = container.getBoundingClientRect();
        const anchor =
            Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]")).find(
                (element) => {
                    const rect = element.getBoundingClientRect();
                    return rect.bottom > top && rect.top < bottom;
                },
            ) ?? null;
        prependScrollRef.current = {
            anchor,
            offset: anchor ? anchor.getBoundingClientRect().top - top : 0,
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

        // После initial load DOM уже знает полную высоту первой страницы.
        if (shouldScrollToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            // Следующие изменения messages не должны снова переносить пользователя вниз.
            shouldScrollToBottomRef.current = false;
            return;
        }

        const previousScroll = prependScrollRef.current;

        if (!previousScroll) {
            return;
        }

        if (previousScroll.anchor && container.contains(previousScroll.anchor)) {
            // Возвращаем то же сообщение на ту же высоту, даже если у bubbles разные размеры.
            const currentOffset =
                previousScroll.anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
            container.scrollTop += currentOffset - previousScroll.offset;
        } else {
            // Запасной вариант, если сообщение-якорь удалили вместе с другим обновлением.
            container.scrollTop =
                previousScroll.scrollTop + (container.scrollHeight - previousScroll.scrollHeight);
        }
        prependScrollRef.current = null;
    }, [messages]);

    return {
        messagesContainerRef,
        scrollToBottomAfterUpdate,
        isNearBottom,
        isNearTop,
        resetScrollPosition,
        saveScrollBeforePrepend,
        clearPrependScrollSnapshot,
    };
};
