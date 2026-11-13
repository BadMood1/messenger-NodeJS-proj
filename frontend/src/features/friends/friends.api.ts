import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
import type { Friend, FriendRequest, FriendRequestDirection } from "./friends.types";

type FriendsResponse = {
    friends: Friend[];
};

type IncomingFriendRequestsResponse = {
    requests: { id: string; createdAt: string; sender: Friend }[];
};

type OutgoingFriendRequestsResponse = {
    requests: { id: string; createdAt: string; receiver: Friend }[];
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

// Получает направление заявок, защищённый request и необязательный signal.
// Загружает существующий endpoint; sender или receiver записывает в общее поле user.
// Возвращает заявки для UI, сохраняя id самой заявки для будущих действий.
export const getFriendRequests = async (
    direction: FriendRequestDirection,
    authenticatedRequest: AuthenticatedRequest,
    { signal }: { signal?: AbortSignal } = {},
): Promise<FriendRequest[]> =>
    runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(`${API_URL}/friends/requests/${direction}`, {
                signal: requestSignal,
            });
            if (!response.ok) throw await createApiRequestError(response, "Failed to load friend requests");

            if (direction === "incoming") {
                const data = (await response.json()) as IncomingFriendRequestsResponse;
                return data.requests.map(({ id, createdAt, sender }) => ({ id, createdAt, user: sender }));
            }

            const data = (await response.json()) as OutgoingFriendRequestsResponse;
            return data.requests.map(({ id, createdAt, receiver }) => ({ id, createdAt, user: receiver }));
        },
        { signal },
    );

// Получает id входящей заявки и функцию защищённых запросов.
// Отправляет POST принятия; права получателя проверяет backend.
// Завершает Promise после успеха; данные пользователя уже есть в загруженной заявке.
export const acceptFriendRequest = async (
    requestId: string,
    authenticatedRequest: AuthenticatedRequest,
): Promise<void> =>
    runRequestAttempt(async (signal) => {
        const response = await authenticatedRequest(`${API_URL}/friends/requests/${encodeURIComponent(requestId)}/accept`, {
            method: "POST",
            signal,
        });
        if (!response.ok) throw await createApiRequestError(response, "Failed to accept friend request");
    });

// Получает id входящей или исходящей заявки и функцию защищённых запросов.
// Отправляет DELETE для отклонения или отмены; 404 означает, что заявки уже нет.
// Завершает Promise после удаления либо пробрасывает ошибку вызывающему хуку.
export const deleteFriendRequest = async (
    requestId: string,
    authenticatedRequest: AuthenticatedRequest,
): Promise<void> =>
    runRequestAttempt(async (signal) => {
        const response = await authenticatedRequest(`${API_URL}/friends/requests/${encodeURIComponent(requestId)}`, {
            method: "DELETE",
            signal,
        });
        if (!response.ok && response.status !== 404) {
            throw await createApiRequestError(response, "Failed to remove friend request");
        }
    });

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
