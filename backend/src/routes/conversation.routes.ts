import { Router } from "express";

import { authMiddleware } from "../middleware/auth.middleware.js";
import { getConversations, openDirectConversation } from "../controllers/conversation.controller.js";

export const conversationRouter = Router();

conversationRouter.get("/", authMiddleware, getConversations);

conversationRouter.post("/direct/:userId", authMiddleware, openDirectConversation);
