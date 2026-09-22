import { prisma } from "../lib/prisma.js";
import { generateRefreshToken, hashRefreshToken } from "../lib/refresh-token.js";

export const createRefreshSession = async (userId: string) => {
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    await prisma.session.create({
        data: {
            userId,
            refreshTokenHash,
            expiresAt,
        },
    });

    // В БД raw token не сохраняем.
    return refreshToken;
};

export const findSessionByRefreshToken = async (refreshToken: string) => {
    const refreshTokenHash = hashRefreshToken(refreshToken);

    return prisma.session.findUnique({
        where: {
            refreshTokenHash,
        },
    });
};

export const deleteSession = async (sessionId: string) => {
    await prisma.session.delete({
        where: {
            id: sessionId,
        },
    });
};

// Удаление сессии по refreshToken
export const deleteSessionByRefreshToken = async (refreshToken: string) => {
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await prisma.session.deleteMany({
        where: {
            refreshTokenHash,
        },
    });
};
