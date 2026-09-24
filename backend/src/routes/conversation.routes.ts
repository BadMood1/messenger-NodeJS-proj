import { Router } from "express";

import { authMiddleware } from "../middleware/auth.middleware.js";
import { getConversations, openDirectConversation } from "../controllers/conversation.controller.js";
import {
    createMessage,
    getMessageHistory,
    removeMessage,
    updateMessage,
} from "../controllers/message.controller.js";

export const conversationRouter = Router();

conversationRouter.get("/", authMiddleware, getConversations);
conversationRouter.get("/:conversationId/messages", authMiddleware, getMessageHistory);

conversationRouter.post("/direct/:userId", authMiddleware, openDirectConversation);
conversationRouter.post("/:conversationId/messages", authMiddleware, createMessage);

conversationRouter.patch("/messages/:messageId", authMiddleware, updateMessage);

conversationRouter.delete("/messages/:messageId", authMiddleware, removeMessage);
