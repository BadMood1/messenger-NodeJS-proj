import type { Request, Response } from "express";
import { searchUsers } from "../services/user.service.js";

export const search = async (req: Request, res: Response) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
        return res.status(200).json({
            users: [],
        });
    }

    const users = await searchUsers(query, res.locals.userId);

    return res.status(200).json({
        users,
    });
};
