import argon2 from "argon2";
import { AppError } from "../errors/app-error.js";

import { createAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import type { LoginUserInput, RegisterUserInput } from "../validators/auth.schema.js";
import { createRefreshSession, findSessionByRefreshToken } from "./session.service.js";

export const registerUser = async (data: RegisterUserInput) => {
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [{ username: data.username }, { email: data.email }],
        },
    });

    if (existingUser) {
        throw new AppError(409, "User already exists");
    }

    const passwordHash = await argon2.hash(data.password);

    const user = await prisma.user.create({
        data: {
            name: data.name,
            username: data.username,
            email: data.email,
            passwordHash,
        },
        omit: {
            passwordHash: true,
        },
    });

    return user;
};

export const loginUser = async (data: LoginUserInput) => {
    const user = await prisma.user.findFirst({
        where: {
            OR: [{ email: data.identifier }, { username: data.identifier }],
        },
    });

    // Специально одинаковая ошибка и для отсутствующего user,
    // и для неправильного password. (Меньше раскрываем инф-ю об аккаунтах)
    if (!user) {
        throw new AppError(401, "Invalid credentials");
    }

    const passwordIsValid = await argon2.verify(user.passwordHash, data.password);

    if (!passwordIsValid) {
        throw new AppError(401, "Invalid credentials");
    }

    const accessToken = await createAccessToken(user.id);

    const refreshToken = await createRefreshSession(user.id);

    // passwordHash нужен внутри сервера для проверки,
    // но клиенту его возвращать нельзя.
    const { passwordHash, ...safeUser } = user;

    return { user: safeUser, accessToken, refreshToken };
};

// Получаем текущего пользователя по userId, который мы положили в res.locals.userId в authMiddleware
export const getCurrentUser = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        omit: {
            passwordHash: true,
        },
    });

    if (!user) {
        throw new AppError(401, "Unauthorized");
    }

    return user;
};

export const refreshAccessToken = async (refreshToken: string) => {
    const session = await findSessionByRefreshToken(refreshToken);

    if (!session) {
        throw new AppError(401, "Invalid refresh token");
    }

    if (session.expiresAt < new Date()) {
        throw new AppError(401, "Refresh token expired");
    }

    return createAccessToken(session.userId);
};
