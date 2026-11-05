import type { Conversation, LocalConversationRead } from "./conversations.types";
import type { ClientMessage } from "../messages/messages.types";
import type { VisibleMessagePosition } from "../messages/scroll/useLastVisibleMessage";
import type { ConversationMessageEvent } from "./conversation-state-updates";
import { isMessageNewerThanLastMessage } from "./conversation-state-updates";
import { isMessageAfterReadState, isReadPositionNewer } from "./conversation-read-state";

// Получает диалоги, увиденную позицию, историю и признак загрузки её последней страницы.
// Сохраняет самую дальнюю локальную границу и позиции известных чужих сообщений в localRead
// Возвращает список с локальным прогрессом; подтверждённую readState не меняет.
export const applyLocalConversationRead = (
    conversations: Conversation[],
    position: VisibleMessagePosition,
    messages: ClientMessage[],
    isLatestHistoryLoaded: boolean,
): Conversation[] =>
    conversations.map((conversation) => {
        if (conversation.id !== position.conversationId) return conversation;
        // Формируем границу; представляет собой только что увиденную границу
        const observedReadState = {
            ...conversation.readState,
            lastReadMessageId: position.messageId,
            lastReadMessageCreatedAt: position.createdAt,
        };
        // Локальный прогресс, сохраненный предыд. вызовом функции
        // Если пользователь прокрутил назад, оставляем самую дальнюю уже увиденную позицию.
        const previousLocalRead = conversation.localRead;
        const readState =
            previousLocalRead && isReadPositionNewer(previousLocalRead.readState, observedReadState)
                ? previousLocalRead.readState
                : observedReadState;
        if (!isReadPositionNewer(readState, conversation.readState)) return conversation;

        // чужие сообщения по id для расчёта непрочитанных.
        const peerMessagesByIdForUnreadCount = new Map(
            previousLocalRead?.messages.map((message) => [message.id, message]) ?? [],
        );
        let latestLoadedMessage = previousLocalRead?.latestLoadedMessage ?? null;
        for (const message of messages) {
            if (message.conversationId !== conversation.id || message.localStatus) continue;
            // Если ласт стр. загружена, берём самое позднее сервер. сообщ.
            if (isLatestHistoryLoaded && isMessageNewerThanLastMessage(message, latestLoadedMessage))
                latestLoadedMessage = message; // конец переписки
            // Добавляем чужие сообщения по id для расчёта непрочитанных.
            if (
                message.senderId !== conversation.readState.userId && // чужое
                !peerMessagesByIdForUnreadCount.get(message.id)?.isDeleted
            ) {
                peerMessagesByIdForUnreadCount.set(message.id, {
                    id: message.id,
                    createdAt: message.createdAt,
                    senderId: message.senderId,
                });
            }
        }
        const localRead: LocalConversationRead = {
            readState,
            latestLoadedMessage,
            messages: [...peerMessagesByIdForUnreadCount.values()].filter((message) =>
                isMessageAfterReadState(message, conversation.readState),
            ),
        };
        return { ...conversation, localRead };
    });

// Получает диалог с серверным счётчиком и локальным прогрессом.
// Убирает уже увиденные чужие сообщения; если известен весь хвост, считает его напрямую.
// Возвращает число для UI без ожидания PATCH и без повторного вычитания подтверждённых сообщений.
export const getDisplayedUnreadCount = (conversation: Conversation) => {
    const local = conversation.localRead;
    if (!local || !isReadPositionNewer(local.readState, conversation.readState))
        return conversation.unreadCount;
    if (conversation.lastMessage && !isMessageAfterReadState(conversation.lastMessage, local.readState))
        return 0;
    // Если окно доходит до последнего сообщения, все оставшиеся непрочитанные нам известны.
    if (
        conversation.lastMessage &&
        local.latestLoadedMessage &&
        !isMessageNewerThanLastMessage(conversation.lastMessage, local.latestLoadedMessage)
    ) {
        return local.messages.filter(
            (message) => !message.isDeleted && isMessageAfterReadState(message, local.readState),
        ).length;
    }
    const locallyReadCount = local.messages.filter(
        (message) =>
            isMessageAfterReadState(message, conversation.readState) &&
            !isMessageAfterReadState(message, local.readState),
    ).length;
    return Math.max(0, conversation.unreadCount - locallyReadCount);
};

// Получает список и socket-событие сообщения.
// Дополняет известный хвост или помечает удалённую позицию, пока PATCH ещё ожидается.
// Возвращает локальный прогресс с учётом новых сообщений; серверный счётчик не меняет.
export const updateLocalReadFromMessage = (conversations: Conversation[], event: ConversationMessageEvent) =>
    conversations.map((conversation) => {
        const local = conversation.localRead;
        if (!local || conversation.id !== event.message.conversationId || event.type === "updated")
            return conversation;
        if (event.type === "deleted") {
            return {
                ...conversation,
                localRead: {
                    ...local,
                    messages: local.messages.map((message) =>
                        message.id === event.message.id ? { ...message, isDeleted: true } : message,
                    ),
                },
            };
        }
        const message = event.message;
        const canExtendKnownTail =
            local.latestLoadedMessage &&
            (!conversation.lastMessage ||
                !isMessageNewerThanLastMessage(conversation.lastMessage, local.latestLoadedMessage));
        const latestLoadedMessage =
            canExtendKnownTail && isMessageNewerThanLastMessage(message, local.latestLoadedMessage)
                ? message
                : local.latestLoadedMessage;
        const messages =
            message.senderId !== conversation.readState.userId &&
            !local.messages.some((known) => known.id === message.id)
                ? [
                      ...local.messages,
                      { id: message.id, createdAt: message.createdAt, senderId: message.senderId },
                  ]
                : local.messages;
        return { ...conversation, localRead: { ...local, latestLoadedMessage, messages } };
    });

// Получает ответ GET, текущие диалоги и признак удаления во время запроса.
// Переносит локальный прогресс; убирает записи об удалённых сообщениях, уже учтённых сервером.
// Возвращает список, в котором старый GET не возвращает увиденные сообщения в непрочитанные.
export const preserveLocalConversationRead = (
    loaded: Conversation[],
    current: Conversation[],
    hadDeletionDuringLoad: boolean,
) => {
    const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
    return loaded.map((conversation) => {
        const previous = currentById.get(conversation.id);
        const local = previous?.localRead;
        if (
            !local ||
            previous.readState.userId !== conversation.readState.userId ||
            !isReadPositionNewer(local.readState, conversation.readState)
        )
            return conversation;
        return {
            ...conversation,
            localRead: {
                ...local,
                messages: hadDeletionDuringLoad
                    ? local.messages
                    : local.messages.filter((message) => !message.isDeleted),
            },
        };
    });
};
