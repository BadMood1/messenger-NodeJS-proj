import type { RequestHandler } from "express";

import { AppError } from "../errors/app-error.js";
import { verifyAccessToken } from "../lib/jwt.js";

// проверяет, пользователь реально авторизован или нет.
export const authMiddleware: RequestHandler = async (req, res, next) => {
    const authorization = req.headers.authorization;

    // Bearer <token> — стандартный формат передачи токена в HTTP заголовке.
    if (!authorization?.startsWith("Bearer ")) {
        throw new AppError(401, "Unauthorized");
    }

    const token = authorization.split(" ")[1];

    if (!token) {
        throw new AppError(401, "Unauthorized");
    }

    try {
        const payload = await verifyAccessToken(token);

        if (!payload.sub) {
            throw new AppError(401, "Unauthorized");
        }

        // sub содержит userId, который мы положили туда при login
        res.locals.userId = payload.sub;

        next(); // дальше
    } catch {
        throw new AppError(401, "Unauthorized");
    }
};
