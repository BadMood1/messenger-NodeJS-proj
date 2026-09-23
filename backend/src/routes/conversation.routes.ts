import { Router } from "express";

import { authMiddleware } from "../middleware/auth.middleware.js";
import { getConversations, openDirectConversation } from "../controllers/conversation.controller.js";
import { createMessage, getMessageHistory } from "../controllers/message.controller.js";

export const conversationRouter = Router();

conversationRouter.get("/", authMiddleware, getConversations);
conversationRouter.get("/:conversationId/messages", authMiddleware, getMessageHistory);

conversationRouter.post("/direct/:userId", authMiddleware, openDirectConversation);
conversationRouter.post("/:conversationId/messages", authMiddleware, createMessage);
