import { API_URL } from "../../lib/config";

export type User = {
    id: string;
    name: string;
    username: string;
    email: string;
    image: string | null;
};

type LoginResponse = {
    user: User;
    accessToken: string;
};

//
export const loginRequest = async (identifier: string, password: string) => {
    const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
        },

        // Нужен, чтобы браузер сохранил refreshToken cookie
        credentials: "include",

        body: JSON.stringify({
            identifier,
            password,
        }),
    });

    if (!response.ok) {
        throw new Error("Invalid credentials");
    }

    return response.json() as Promise<LoginResponse>;
};

// Получаем новый accessToken через refreshToken cookie, если он есть
export const refreshRequest = async () => {
    // Body не нужен — refreshToken браузер отправит через cookie
    const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
    });

    if (!response.ok) {
        return null;
    }

    return response.json() as Promise<{
        accessToken: string;
    }>;
};

export const getMeRequest = async (accessToken: string) => {
    const response = await fetch(`${API_URL}/auth/me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error("Unauthorized");
    }

    return response.json() as Promise<{
        user: User;
    }>;
};
