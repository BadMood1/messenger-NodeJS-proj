import type { Request, Response } from "express";

import { messageHistoryQuerySchema, sendMessageSchema } from "../validators/message.schema.js";
import { getMessages, sendMessage } from "../services/message.service.js";

export const createMessage = async (req: Request<{ conversationId: string }>, res: Response) => {
    const senderId = res.locals.userId;

    // id чата берём из URL
    const conversationId = req.params.conversationId;

    // Проверяем body и получаем уже очищенный content
    const { content } = sendMessageSchema.parse(req.body);

    const message = await sendMessage(conversationId, senderId, content);

    return res.status(201).json({
        message,
    });
};

export const getMessageHistory = async (req: Request<{ conversationId: string }>, res: Response) => {
    const userId = res.locals.userId;

    // id чата из URL
    const conversationId = req.params.conversationId;

    // cursor и limit берём из ?cursor=...&limit=...
    const { cursor, limit } = messageHistoryQuerySchema.parse(req.query);

    const result = await getMessages(conversationId, userId, cursor, limit);

    return res.status(200).json(result);
};
