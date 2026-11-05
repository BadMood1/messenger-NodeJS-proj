import type { Conversation, ConversationReadState } from "./conversations.types";
import type { Message } from "../messages/messages.types";
import { isMessageAfterReadState, isReadPositionNewer } from "./conversation-read-state";

// Получает сообщение и подтверждённую границу собеседника.
// Проверяет, находится ли сообщение до этой границы включительно.
// Возвращает признак прочтения; отсутствие границы означает, что подтверждения пока нет.
export const isMessageReadByPeer = (message: Pick<Message, "id" | "createdAt">, peerReadState: ConversationReadState | null) =>
    Boolean(peerReadState?.lastReadMessageCreatedAt && !isMessageAfterReadState(message, peerReadState));

// Получает диалоги и подтверждённое прочтение другого участника.
// Сдвигает только peerReadState нужного собеседника и пропускает старые события.
// Возвращает список для обновления галочек, не меняя собственный счётчик пользователя.
export const applyPeerReadReceipt = (conversations: Conversation[], readState: ConversationReadState) =>
    conversations.map((conversation) => {
        if (conversation.id !== readState.conversationId || conversation.user?.id !== readState.userId ||
            !isReadPositionNewer(readState, conversation.peerReadState)) return conversation;
        return { ...conversation, peerReadState: readState };
    });
