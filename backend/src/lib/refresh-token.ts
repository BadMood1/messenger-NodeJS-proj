import { createHash, randomBytes } from "node:crypto";

export const generateRefreshToken = () => {
    // Криптографически случайная строка, которую невозможно нормально угадать
    return randomBytes(64).toString("base64url");
};

export const hashRefreshToken = (token: string) => {
    return createHash("sha256").update(token).digest("hex");
};
