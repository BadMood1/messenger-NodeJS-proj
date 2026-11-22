import { useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { UserSearchResult } from "../users/users.types";
import { ApiRequestError } from "../../lib/api-request-error";
import { sendFriendRequest } from "./friends.api";
import type { FriendRequest } from "./friends.types";

type UseSendFriendRequestOptions = {
    authenticatedRequest: AuthenticatedRequest;
    onRequestSent: (request: FriendRequest) => void;
    onFriendshipConflict: () => void;
    hasConfirmedOutgoingRequestSince: (userId: string, requestStartedAt: number) => boolean;
};

// Получает защищённый request и обработчики успешной отправки и конфликта отношений.
// Отправляет одну заявку за раз и сохраняет ошибку выбранной строки; статусы обновляет общий обработчик.
// Возвращает отправку, её состояние и очистку ошибки для нового открытия поиска.
export const useSendFriendRequest = ({
    authenticatedRequest,
    onRequestSent,
    onFriendshipConflict,
    hasConfirmedOutgoingRequestSince,
}: UseSendFriendRequestOptions) => {
    const [sendingUserId, setSendingUserId] = useState<string | null>(null);
    const [sendError, setSendError] = useState<{ userId: string; message: string } | null>(null);
    const sendingControllerRef = useRef<AbortController | null>(null);

    // Закрытие окна не отменяет начатый POST: его успешный результат ещё нужен списку Outgoing.
    // При уходе со страницы отменяем ожидание и не обновляем уже размонтированный UI.
    useEffect(() => () => sendingControllerRef.current?.abort(), []);

    // Получает пользователя из текущих результатов поиска.
    // Выполняет POST, затем передаёт созданную заявку общему обработчику Outgoing и статусов поиска.
    // Возвращает true при успехе; при ошибке сохраняет сообщение в строке и разрешает повторить.
    const sendFriendRequestToUser = async (user: UserSearchResult) => {
        if (sendingControllerRef.current || user.friendshipStatus !== "NONE") return false;
        const controller = new AbortController();
        const requestStartedAt = performance.now();
        // Ref блокирует повторный клик сразу, до рендера disabled-кнопок.
        sendingControllerRef.current = controller;
        setSendingUserId(user.id);
        setSendError(null);
        try {
            const createdRequest = await sendFriendRequest(user.id, authenticatedRequest, {
                signal: controller.signal,
            });
            if (controller.signal.aborted) return false;
            // По цепочке обновится Outgoing
            onRequestSent({
                ...createdRequest,
                user: { id: user.id, name: user.name, username: user.username, image: user.image },
            });
            return true;
        } catch (error) {
            if (controller.signal.aborted) return false;
            // Если socket уже подтвердил заявку, потеря ответа POST не означает неуспешную отправку.
            if (hasConfirmedOutgoingRequestSince(user.id, requestStartedAt)) return true;
            let message =
                error instanceof ApiRequestError
                    ? error.message
                    : "Could not send the request. Please try again.";
            // Если связь уже существует, перечитываем её статус и списки; успешную отправку не подставляем.
            if (error instanceof ApiRequestError && error.status === 409) {
                message = "Your relationship with this user has changed. Check the updated status.";
                onFriendshipConflict();
            }
            setSendError({ userId: user.id, message });
            return false;
        } finally {
            sendingControllerRef.current = null;
            if (!controller.signal.aborted) setSendingUserId(null);
        }
    };

    // Получает новое открытие поиска.
    // Убирает прошлую ошибку; отношения берутся из поиска и общих событий friendship.
    // Сохраняет выполняющийся POST и его блокировку, если окно успели закрыть и открыть снова.
    const clearSendError = () => setSendError(null);

    return { sendingUserId, sendError, sendFriendRequestToUser, clearSendError };
};
