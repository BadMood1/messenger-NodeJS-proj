import { Router } from "express";

import { authMiddleware } from "../middleware/auth.middleware.js";

import {
    acceptRequest,
    getFriendsList,
    getIncomingRequests,
    getOutgoingRequests,
    deleteRequest,
    removeFriendController,
    sendRequest,
} from "../controllers/friend.controller.js";

export const friendRouter = Router();

friendRouter.get("/", authMiddleware, getFriendsList);
friendRouter.get("/requests/incoming", authMiddleware, getIncomingRequests);
friendRouter.get("/requests/outgoing", authMiddleware, getOutgoingRequests);

friendRouter.post("/requests/:userId", authMiddleware, sendRequest);
friendRouter.post("/requests/:requestId/accept", authMiddleware, acceptRequest);

// юзать как DELETE /api/friends/requests/:requestId
friendRouter.delete("/requests/:requestId", authMiddleware, deleteRequest);
friendRouter.delete("/:userId", authMiddleware, removeFriendController);
