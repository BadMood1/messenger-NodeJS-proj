import { useEffect, useState, type RefObject } from "react";

import type { ClientMessage } from "./messages.api";

export type VisibleMessagePosition = {
    conversationId: string;
    messageId: string;
    createdAt: string;
};

type UseLastVisibleMessageOptions = {
    conversationId: string | null;
    messages: ClientMessage[];
    messagesContainerRef: RefObject<HTMLDivElement | null>;
    isEnabled: boolean;
};

// Получает id чата, отсортированные сообщения, контейнер и разрешение на наблюдение.
// Следит за видимостью нижней части серверных сообщений только в активной вкладке.
// Возвращает позицию последнего видимого сообщения или null; запросы не отправляет.
export const useLastVisibleMessage = ({
    conversationId,
    messages,
    messagesContainerRef,
    isEnabled,
}: UseLastVisibleMessageOptions) => {
    const [lastVisibleMessage, setLastVisibleMessage] = useState<VisibleMessagePosition | null>(null);

    // ------- НАБЛЮДЕНИЕ ЗА СООБЩЕНИЯМИ ОТКРЫТОГО ЧАТА -------
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!isEnabled || !conversationId || !container) {
            setLastVisibleMessage(null);
            return;
        }

        let isObservationStopped = false; // закончилось ли именно это наблюдение
        const visibleMessageIds = new Set<string>(); // id сообщений нижняя часть которых сейчас полностью видна
        // Временные sending/failed сообщения не могут быть границей прочтения в backend.
        const serverMessages = messages.filter(
            (message) => message.conversationId === conversationId && !message.localStatus,
        );
        const serverMessageIds = new Set(serverMessages.map((message) => message.id));

        // Вызывается после изменения видимости сообщений или активности вкладки.
        // Ищет последнее сообщение с видимым концом, перебирая историю от новых к старым.
        // Сохраняет его позицию в state; если такого сообщения нет — сохраняет null.
        const updateLastVisibleMessage = () => {
            if (isObservationStopped) return;
            let nextVisibleMessage: VisibleMessagePosition | null = null;
            const isTabActive = !document.hidden && document.hasFocus();

            if (isTabActive) {
                // serverMessages от старых к новым. Идём с конца
                for (let index = serverMessages.length - 1; index >= 0; index--) {
                    const message = serverMessages[index];
                    if (!visibleMessageIds.has(message.id)) continue;

                    nextVisibleMessage = {
                        conversationId,
                        messageId: message.id,
                        createdAt: message.createdAt,
                    };
                    break;
                }
            }

            setLastVisibleMessage((previousMessage) => {
                // Если всё одинаково, то ничего не просим обновляться
                if (
                    previousMessage?.conversationId === nextVisibleMessage?.conversationId &&
                    previousMessage?.messageId === nextVisibleMessage?.messageId &&
                    previousMessage?.createdAt === nextVisibleMessage?.createdAt
                )
                    return previousMessage;

                return nextVisibleMessage;
            });
        };

        // Браузер вызывает когда пересекаем элементы
        // entries передаёт браузер
        // После обновления Set выбирает последнее видимое сообщение.
        const handleIntersections = (entries: IntersectionObserverEntry[]) => {
            if (isObservationStopped) return;
            for (const entry of entries) {
                const messageId = entry.target.getAttribute("data-read-target-message-id");
                if (!messageId || !serverMessageIds.has(messageId)) continue;

                // если блок времени полностью виден - добавляем ID в Set
                if (entry.isIntersecting && entry.intersectionRatio === 1) visibleMessageIds.add(messageId);
                else visibleMessageIds.delete(messageId);
            }
            // после обработки всех entries выбираем last visible
            updateLastVisibleMessage();
        };

        // Браузер проверяет видимость в viewport с учётом обрезки прокручиваемым контейнером чата.
        // threshold: 1 - интересует полная видимость наблюдаемого блока
        const observer = new IntersectionObserver(handleIntersections, { threshold: 1 });

        // Вызывается при focus, blur, visibilitychange и начале наблюдения.
        // Сбрасывает прежний замер; в активной вкладке заново наблюдает за концами сообщений.
        // В неактивной вкладке оставляет наблюдение выключенным, а позицию — null.
        const handleTabActivity = () => {
            observer.disconnect();
            observer.takeRecords(); // (Забираем и тем самым) очищаем старые уведомления перед новым замером.
            visibleMessageIds.clear();
            updateLastVisibleMessage();
            // вкладка скрыта или без фокуса - заканчиваем
            if (document.hidden || !document.hasFocus()) return;

            for (const element of container.querySelectorAll("[data-read-target-message-id]")) {
                const messageId = element.getAttribute("data-read-target-message-id");
                // observe - "сообщай мне о видимости этого элемента". Дальше observer будет вызывать handleIntersections
                if (messageId && serverMessageIds.has(messageId)) observer.observe(element);
            }
        };

        window.addEventListener("focus", handleTabActivity); // вернулись в окно
        window.addEventListener("blur", handleTabActivity); // окно потеряло фокус
        document.addEventListener("visibilitychange", handleTabActivity); // вкладка скрылась или стала видимой
        handleTabActivity();

        return () => {
            isObservationStopped = true;
            observer.disconnect();
            window.removeEventListener("focus", handleTabActivity);
            window.removeEventListener("blur", handleTabActivity);
            document.removeEventListener("visibilitychange", handleTabActivity);
        };
        // !
    }, [conversationId, messages, messagesContainerRef, isEnabled]);

    // При смене чата или отключении наблюдения не отдаём старую позицию до выполнения эффекта.
    if (!isEnabled || lastVisibleMessage?.conversationId !== conversationId) return null;
    if (!messages.some((message) => message.id === lastVisibleMessage.messageId && !message.localStatus))
        return null;

    return lastVisibleMessage;
};
