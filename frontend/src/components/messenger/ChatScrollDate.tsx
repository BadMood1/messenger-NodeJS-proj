import { useLayoutEffect, useState, type RefObject } from "react";

import type { ClientMessage } from "../../features/messages/messages.api";
import { getMessageDateSeparatorLabel } from "../../features/messages/message-date-separators";

// Получает элементы в порядке истории и верхнюю границу видимой области.
// Делит диапазон пополам, пока не найдёт первый элемент с нижним краем ниже этой границы.
// Возвращает этот элемент; если все элементы выше границы — undefined.
const findFirstElementBelowTop = (elements: HTMLElement[], top: number) => {
    // бинарный поиск
    let start = 0;
    let end = elements.length;
    while (start < end) {
        const middle = Math.floor((start + end) / 2);
        if (elements[middle].getBoundingClientRect().bottom <= top) start = middle + 1;
        else end = middle;
    }
    return elements[start];
};

type ChatScrollDateProps = {
    messages: readonly Pick<ClientMessage, "id" | "createdAt">[];
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    isEnabled: boolean;
};

// Получает сообщения, контейнер истории и признак чтения выше конца переписки.
// Определяет дату верхнего видимого сообщения при скролле и изменении размеров.
// Показывает закреплённую дату, если сверху ещё нет обычного разделителя.
export const ChatScrollDate = ({ messages, messagesContainerRef, isEnabled }: ChatScrollDateProps) => {
    const [scrollDate, setScrollDate] = useState({ label: "", isVisible: false });

    useLayoutEffect(() => {
        const container = messagesContainerRef.current;
        if (!container || !isEnabled) return;

        const messageElements = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"));
        const separators = Array.from(
            container.querySelectorAll<HTMLElement>("[data-date-separator], [data-unread-separator]"),
        );
        const datesByMessageId = new Map(messages.map(({ id, createdAt }) => [id, createdAt]));
        let frameId = 0;
        let hideTimerId: ReturnType<typeof setTimeout> | undefined;

        // Вызывается после паузы в прокрутке.
        // Убирает видимость, сохраняя последнюю подпись.
        // Позволяет плашке плавно исчезнуть, не закрывая текст сообщения постоянно.
        const hideDate = () => {
            setScrollDate((previous) => (previous.isVisible ? { ...previous, isVisible: false } : previous));
        };

        // Вызывается в запланированном кадре после изменений DOM и восстановления скролла.
        // Находит верхнее сообщение и проверяет, не занят ли верх обычным разделителем.
        // Обновляет подпись и видимость; при скрытии сохраняет текст для плавного ухода.
        const updateDate = () => {
            frameId = 0;
            const { top, bottom } = container.getBoundingClientRect();
            // сообщ., нижний край которого ещё ниже top(мб частично обрезано сверху)
            const message = findFirstElementBelowTop(messageElements, top);
            const messageId = message?.dataset.messageId;
            const createdAt = messageId ? datesByMessageId.get(messageId) : undefined;
            const dateLabel = createdAt ? getMessageDateSeparatorLabel(createdAt) : null;
            const separator = findFirstElementBelowTop(separators, top);
            // Если обычный разделитель занял верхние 48px, плавающую дату скрываем.
            const isSeparatorAtTop = Boolean(separator && separator.getBoundingClientRect().top < top + 48);
            const isVisible = Boolean(
                dateLabel && message && message.getBoundingClientRect().top < bottom && !isSeparatorAtTop,
            );
            setScrollDate((previous) => {
                const label = dateLabel ?? previous.label;
                return previous.label === label && previous.isVisible === isVisible
                    ? previous
                    : { label, isVisible };
            });
            clearTimeout(hideTimerId);
            if (isVisible) hideTimerId = setTimeout(hideDate, 1200);
        };

        // Получает scroll или уведомление об изменении размеров истории.
        // Назначает одно измерение на следующий кадр; остальные события этого кадра объединяет.
        // Не запускает запросы и не меняет позицию скролла.
        const scheduleUpdate = () => {
            // requestAnimationFrame просит браузер перед ближайшей перерисовкой экрана выполнить updateDate
            if (!frameId) frameId = requestAnimationFrame(updateDate);
        };
        // passive сообщает браузеру, что обработчик не будет отменять стандартное действие
        container.addEventListener("scroll", scheduleUpdate, { passive: true });
        // пересчитывает плавающую дату, когда размеры чата изменились
        const observer = new ResizeObserver(scheduleUpdate);
        observer.observe(container);
        // следим также за обёрткой всего списка сообщений
        if (container.firstElementChild) observer.observe(container.firstElementChild);
        scheduleUpdate(); // первое измерение сразу после настройки
        return () => {
            cancelAnimationFrame(frameId);
            clearTimeout(hideTimerId);
            container.removeEventListener("scroll", scheduleUpdate);
            observer.disconnect();
        };
    }, [messages, messagesContainerRef, isEnabled]);

    return (
        <div
            className="flux-chat-scroll-date"
            data-visible={isEnabled && scrollDate.isVisible}
            aria-hidden="true"
        >
            {scrollDate.label}
        </div>
    );
};
