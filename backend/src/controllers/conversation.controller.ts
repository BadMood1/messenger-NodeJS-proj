import type { Request, Response } from "express";

import { getDirectConversations, getOrCreateDirectConversation } from "../services/conversation.service.js";
import { markConversationRead } from "../services/conversation-read.service.js";
import { conversationParamsSchema, markConversationReadSchema } from "../validators/conversation.schema.js";

export const openDirectConversation = async (req: Request<{ userId: string }>, res: Response) => {
    // Кто делает запрос — берём из access token
    const currentUserId = res.locals.userId;

    // С кем хотим открыть чат — берём из URL
    const otherUserId = req.params.userId;

    const conversation = await getOrCreateDirectConversation(currentUserId, otherUserId);

    return res.status(200).json({
        conversation,
    });
};

export const getConversations = async (req: Request, res: Response) => {
    const userId = res.locals.userId;

    const conversations = await getDirectConversations(userId);

    return res.status(200).json({
        conversations,
    });
};

// Получает id чата из URL, messageId из body и userId из проверенного access token.
// Проверяет входные данные и передаёт отметку прочтения в service.
// Возвращает сохранённую границу в поле readState, не отмечая сообщения другого участника.
export const markConversationAsRead = async (req: Request<{ conversationId: string }>, res: Response) => {
    const { conversationId } = conversationParamsSchema.parse(req.params);
    const { messageId } = markConversationReadSchema.parse(req.body);
    const userId = res.locals.userId;

    const readState = await markConversationRead(conversationId, userId, messageId);

    return res.status(200).json({ readState });
};
