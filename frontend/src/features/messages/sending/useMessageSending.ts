import { useRef } from "react";

import type { AuthenticatedRequest } from "../../auth/authenticated-request";
import type { ClientMessage, Message, MessageSender } from "../messages.types";
import { sendMessage as sendMessageRequest } from "../messages.api";
import { mergeMessage } from "../state/message-state-updates";
import { getNextLocalDisplayOrder, sortMessagesForDisplay } from "../state/message-ordering";
import type { useConversationMessageState } from "../state/useConversationMessageState";

type UseMessageSendingOptions = {
    enabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
    currentUser: MessageSender | null;
    messageState: ReturnType<typeof useConversationMessageState>;
    scrollToBottomAfterUpdate: () => void;
    requestLatestWindowForSend: () => void;
};

// Получает общий state сообщений, пользователя, защищённый request и обработчики истории/скролла.
// Управляет optimistic Send/Retry и таблицей ещё выполняющихся POST.
// Возвращает отправку, повтор и удаление локального failed-сообщения без DELETE API.
export const useMessageSending = ({
    enabled,
    authenticatedRequest,
    currentUser,
    messageState,
    scrollToBottomAfterUpdate,
    requestLatestWindowForSend,
}: UseMessageSendingOptions) => {
    const { messages, setMessages, conversationIdRef, historyVersionRef, applyKnownChanges } = messageState;
    // Текущие POST: данные нужны и для защиты от дублей, и для связи следующей отправки с предыдущей.
    const sendingMessagesRef = useRef(new Map<string, ClientMessage>());

    // Получает id чата.
    // Находит последнюю отправку этого чата, чей POST ещё выполняется.
    // Возвращает её clientMessageId или undefined, если зависимость уже не нужна.
    const getPreviousPendingClientMessageId = (currentConversationId: string) =>
        [...sendingMessagesRef.current.values()]
            .filter((message) => message.conversationId === currentConversationId)
            .at(-1)?.clientMessageId ?? undefined;

    // выполняет POST и заменяет temp-сообщение на серверное, либо помечает его как failed.
    // Получает временное сообщение с клиентским id и необязательным предшественником.
    // Выполняет POST один раз и применяет подтверждение либо failed к актуальному чату.
    // После завершения убирает отправку из таблицы выполняющихся запросов.
    const deliverMessage = async (pending: ClientMessage) => {
        if (sendingMessagesRef.current.has(pending.id)) return; // проверка повторной отправки, если пользователь быстро нажал кнопку несколько раз.
        sendingMessagesRef.current.set(pending.id, pending); // регистрируем отправку

        const historyVersion = historyVersionRef.current;
        // Проверяем и поколение чата: уйти и вернуться в тот же id тоже считается сменой истории.
        const isCurrent = () =>
            conversationIdRef.current === pending.conversationId &&
            historyVersionRef.current === historyVersion;
        try {
            const message = await sendMessageRequest(
                pending.conversationId,
                pending.content,
                authenticatedRequest,
                pending.replyToId ?? undefined,
                pending.clientMessageId ?? undefined, // тот же UUID при первой отправке и при Retry
                pending.previousClientMessageId,
            );
            // Проверяем можно ли обновл. текущий чат
            if (isCurrent()) {
                // меняем state
                // По id убираем серверный дубль, по clientMessageId заменяем свой temp.
                setMessages((current) =>
                    current.some((item) => item.id === pending.id)
                        ? applyKnownChanges(mergeMessage(current, message))
                        : current,
                ); // socket уже заменил temp; поздний POST не вернёт сообщение после локального Delete
            }
        } catch (error) {
            if (isCurrent()) {
                // меняем state
                setMessages((current) =>
                    // если есть другие sending, сохр. временный порядок, если больше нет - убираем localDisplayOrder
                    // у подтвержденных сообщ. и сортируем их по серверным датам (по createdAt)
                    sortMessagesForDisplay(
                        current.map((item) =>
                            item.id === pending.id // нашли наше временное сообщение
                                ? {
                                      ...item,
                                      localStatus: "failed",
                                      sendError:
                                          error instanceof Error ? error.message : "Failed to send message",
                                  }
                                : item,
                        ),
                    ),
                );
            }
        } finally {
            sendingMessagesRef.current.delete(pending.id);
        }
    };

    // Получает текст и необязательное сообщение для Reply.
    // Добавляет optimistic-сообщение и сразу запускает POST, связывая его с предыдущей отправкой.
    // Обновляет список и запрашивает конец истории, если пользователь читал старый участок.
    const sendMessage = (content: string, replyTo?: Message) => {
        const currentConversationId = conversationIdRef.current;

        if (!currentConversationId || !enabled || !currentUser) {
            throw new Error("No conversation selected");
        }

        const now = new Date().toISOString();
        const clientMessageId = crypto.randomUUID(); // создаём один раз; Retry копирует его вместе с pending
        // Создали объект сообщения с временным id, чтобы сразу показать его в списке.
        const pending: ClientMessage = {
            id: `temp:${clientMessageId}`, // локальный id для UI, не серверный Message.id
            clientMessageId,
            previousClientMessageId: getPreviousPendingClientMessageId(currentConversationId),
            content,
            createdAt: now,
            updatedAt: now,
            senderId: currentUser.id,
            sender: currentUser,
            conversationId: currentConversationId,
            replyToId: replyTo?.id ?? null,
            replyTo: replyTo
                ? {
                      id: replyTo.id,
                      content: replyTo.content,
                      updatedAt: replyTo.updatedAt,
                      sender: replyTo.sender,
                  }
                : null,
            localStatus: "sending",
        };
        scrollToBottomAfterUpdate(); // просим существующий useLayoutEffect прокрутить вниз после отрисовки.
        // Считаем позицию по актуальному state, включая несколько Send до следующего рендера.
        setMessages((current) => [
            ...current,
            { ...pending, localDisplayOrder: getNextLocalDisplayOrder(current, Date.parse(now)) },
        ]); // добавляем сообщ. в конец списка, чтобы сразу показать его в UI.
        // Если читали середину переписки, собственная отправка открывает последнее окно без пробела в истории.
        requestLatestWindowForSend();
        // Ошибки POST остаются в bubble, а composer можно сразу использовать снова.
        void deliverMessage(pending); // асинхронно отправляем на сервер, не дожидаясь ответа.
    };

    // Получает id failed-сообщения из меню Retry.
    // Переносит ту же отправку вниз, обновляет время и определяет нового предшественника.
    // Повторяет POST с прежними content, reply и clientMessageId.
    const retryMessage = (messageId: string) => {
        const pending = messages.find((message) => message.id === messageId);
        if (!pending || pending.localStatus !== "failed" || sendingMessagesRef.current.has(messageId)) return;
        const now = new Date().toISOString();
        const retried: ClientMessage = {
            ...pending,
            previousClientMessageId: getPreviousPendingClientMessageId(pending.conversationId),
            createdAt: now,
            updatedAt: now,
            localStatus: "sending",
            sendError: undefined,
        };
        // Retry — новая попытка сейчас: переносим тот же temp вниз и сразу обновляем время.
        scrollToBottomAfterUpdate();
        setMessages((current) => [
            ...current.filter((message) => message.id !== messageId),
            { ...retried, localDisplayOrder: getNextLocalDisplayOrder(current, Date.parse(now)) },
        ]);
        requestLatestWindowForSend();
        void deliverMessage(retried);
    };

    // Получает id сообщения, которое пользователь решил удалить.
    // Если это локальное failed-сообщение, убирает его из state, когда POST уже завершён.
    // Возвращает true для локального failed: DELETE API для него вызывать не нужно.
    const discardFailedMessage = (messageId: string) => {
        if (!messages.some((message) => message.id === messageId && message.localStatus === "failed")) return false;
        if (!sendingMessagesRef.current.has(messageId)) {
            setMessages((current) => current.filter((message) => message.id !== messageId));
        }
        return true;
    };

    return { sendMessage, retryMessage, discardFailedMessage };
};
