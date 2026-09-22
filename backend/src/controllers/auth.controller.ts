import type { Request, Response } from "express";

import { loginSchema, registerSchema } from "../validators/auth.schema.js";
import { getCurrentUser, loginUser, refreshAccessToken, registerUser } from "../services/auth.service.js";
import { AppError } from "../errors/app-error.js";
import { deleteSessionByRefreshToken } from "../services/session.service.js";

export const register = async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);

    const user = await registerUser(data);

    return res.status(201).json({
        user,
    });
};

export const login = async (req: Request, res: Response) => {
    const data = loginSchema.parse(req.body);

    const result = await loginUser(data);

    res.cookie("refreshToken", result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
    });
};

export const me = async (req: Request, res: Response) => {
    const user = await getCurrentUser(res.locals.userId);

    return res.status(200).json({
        user,
    });
};

export const refresh = async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
        throw new AppError(401, "Refresh token required");
    }

    const accessToken = await refreshAccessToken(refreshToken);

    return res.status(200).json({
        accessToken,
    });
};

export const logout = async (req: Request, res: Response) => {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
        await deleteSessionByRefreshToken(refreshToken);
    }

    res.clearCookie("refreshToken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
    });

    return res.status(204).send();
};
