import { SignJWT, jwtVerify } from "jose";

// secret для подписи JWT токенов

const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;

if (!accessTokenSecret) {
    throw new Error("ACCESS_TOKEN_SECRET is not defined");
}

const secret = new TextEncoder().encode(accessTokenSecret);

export const createAccessToken = async (userId: string) => {
    const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;

    if (!accessTokenSecret) {
        throw new Error("ACCESS_TOKEN_SECRET is not set");
    }

    // `sub` — стандартный JWT claim для идентификатора субъекта (пользователя).
    return new SignJWT()
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime("15m")
        .sign(new TextEncoder().encode(accessTokenSecret));
};

export const verifyAccessToken = async (token: string) => {
    const { payload } = await jwtVerify(token, secret);

    return payload;
};
