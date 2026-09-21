import type { Request, Response } from "express";

import { loginSchema, registerSchema } from "../validators/auth.schema.js";
import { getCurrentUser, loginUser, registerUser } from "../services/auth.service.js";

export const register = async (req: Request, res: Response) => {
    const data = registerSchema.parse(req.body);

    const user = await registerUser(data);

    return res.status(201).json({
        user,
    });
};

export const login = async (req: Request, res: Response) => {
    const data = loginSchema.parse(req.body);

    const { user, accessToken } = await loginUser(data);

    return res.status(200).json({
        user,
        accessToken,
    });
};

export const me = async (req: Request, res: Response) => {
    const user = await getCurrentUser(res.locals.userId);

    return res.status(200).json({
        user,
    });
};
