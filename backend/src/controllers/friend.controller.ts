import type { Request, Response } from "express";
import {
    acceptFriendRequest,
    getIncomingFriendRequests,
    sendFriendRequest,
    deleteFriendRequest,
    getFriends,
    getOutgoingFriendRequests,
    removeFriend,
} from "../services/friend.service.js";

export const sendRequest = async (req: Request<{ userId: string }>, res: Response) => {
    const senderId = res.locals.userId; // берём id (кладём в authMiddleware)
    const receiverId = req.params.userId;

    const friendship = await sendFriendRequest(senderId, receiverId);

    return res.status(201).json({
        friendship,
    });
};

export const getIncomingRequests = async (req: Request, res: Response) => {
    const userId = res.locals.userId;

    const requests = await getIncomingFriendRequests(userId);

    return res.status(200).json({
        requests,
    });
};

export const acceptRequest = async (req: Request<{ requestId: string }>, res: Response) => {
    const userId = res.locals.userId;
    const requestId = req.params.requestId; // из ссылки

    const friendship = await acceptFriendRequest(requestId, userId);

    return res.status(200).json({
        friendship,
    });
};

export const deleteRequest = async (req: Request<{ requestId: string }>, res: Response) => {
    const userId = res.locals.userId;
    const requestId = req.params.requestId; // из ссылки

    await deleteFriendRequest(requestId, userId);

    return res.status(204).send();
};

export const getFriendsList = async (req: Request, res: Response) => {
    const userId = res.locals.userId;

    const friends = await getFriends(userId);

    return res.status(200).json({
        friends,
    });
};

export const getOutgoingRequests = async (req: Request, res: Response) => {
    const userId = res.locals.userId;

    const requests = await getOutgoingFriendRequests(userId);

    return res.status(200).json({
        requests,
    });
};

export const removeFriendController = async (req: Request<{ userId: string }>, res: Response) => {
    const currentUserId = res.locals.userId;
    const friendId = req.params.userId;

    await removeFriend(currentUserId, friendId);

    return res.status(204).send();
};
