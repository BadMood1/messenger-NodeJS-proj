import type { Request, Response } from "express";

import { getDirectConversations, getOrCreateDirectConversation } from "../services/conversation.service.js";

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
