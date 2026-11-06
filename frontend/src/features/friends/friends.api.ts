import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
import type { Friend } from "./friends.types";

type FriendsResponse = {
    friends: Friend[];
};

// Получает функцию защищённых запросов и необязательный signal отмены.
// Загружает GET /friends с общим timeout и обработкой HTTP-ошибок.
// Возвращает публичные данные друзей из фактического ответа backend.
export const getFriends = async (
    authenticatedRequest: AuthenticatedRequest,
    { signal }: { signal?: AbortSignal } = {},
): Promise<Friend[]> =>
    runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(`${API_URL}/friends`, { signal: requestSignal });
            if (!response.ok) throw await createApiRequestError(response, "Failed to load friends");
            const data = (await response.json()) as FriendsResponse;
            return data.friends;
        },
        { signal },
    );

// Получает id друга и функцию защищённых запросов.
// Отправляет DELETE; отсутствие дружбы после повторного действия тоже считает успехом.
// Завершает Promise после удаления либо возвращает HTTP-ошибку через throw.
export const removeFriend = async (userId: string, authenticatedRequest: AuthenticatedRequest): Promise<void> =>
    runRequestAttempt(async (signal) => {
        const response = await authenticatedRequest(`${API_URL}/friends/${encodeURIComponent(userId)}`, {
            method: "DELETE",
            signal,
        });
        if (!response.ok && response.status !== 404) {
            throw await createApiRequestError(response, "Failed to remove friend");
        }
    });
