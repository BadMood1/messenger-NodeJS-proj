import { useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { requestWithRetry, type RequestRetryState } from "../../lib/request-retry";
import { acceptFriendRequest, deleteFriendRequest, getFriendRequests } from "./friends.api";
import type { FriendRequest, FriendRequestAction, FriendRequestDirection } from "./friends.types";

// Получает постоянное направление списка, защищённый request и активность Friends.
// Загружает заявки с ограниченным retry; сохраняет данные при уходе из раздела.
// Возвращает список, загрузку/retry и действия с отдельными состояниями ожидания и ошибки.
export const useFriendRequests = (
    direction: FriendRequestDirection,
    authenticatedRequest: AuthenticatedRequest,
    isEnabled: boolean,
) => {
    // загруженные заявки этого направления(incoming/outgoing)
    const [requests, setRequests] = useState<FriendRequest[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [requestRetry, setRequestRetry] = useState<RequestRetryState | null>(null);
    const [reloadVersion, setReloadVersion] = useState(0);
    const [pendingAction, setPendingAction] = useState<{
        requestId: string;
        action: FriendRequestAction;
    } | null>(null);
    const [actionError, setActionError] = useState<{ requestId: string; message: string } | null>(null);
    const isSubmittingActionRef = useRef(false);
    // заявки, которые мы уже успешно обработали как-либо
    const resolvedRequestIdsDuringLoadRef = useRef(new Set<string>());

    // ------- ЗАГРУЗКА ОДНОГО НАПРАВЛЕНИЯ -------
    useEffect(() => {
        if (!isEnabled) return;
        const controller = new AbortController();
        const resolvedRequestIdsDuringLoad = new Set<string>();
        resolvedRequestIdsDuringLoadRef.current = resolvedRequestIdsDuringLoad;

        // Получает открытие Friends или ручной повтор загрузки.
        // Выполняет GET выбранного направления и сохраняет успешный ответ.
        // После отмены не меняет список, ошибку и состояние загрузки.
        const loadFriendRequests = async () => {
            setIsLoading(true);
            setError(null);
            setRequestRetry(null);
            setActionError(null);
            try {
                const result = await requestWithRetry(
                    () => getFriendRequests(direction, authenticatedRequest, { signal: controller.signal }),
                    {
                        signal: controller.signal,
                        onRetryState: (retry) => {
                            if (!controller.signal.aborted) setRequestRetry(retry);
                        },
                    },
                );
                if (controller.signal.aborted) return;
                // Если действие завершилось во время GET, старый ответ не возвращает заявку.
                setRequests(result.filter((request) => !resolvedRequestIdsDuringLoad.has(request.id)));
            } catch (error) {
                if (!controller.signal.aborted) {
                    setError(error instanceof Error ? error.message : "Failed to load friend requests");
                }
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        };

        void loadFriendRequests();
        // Уход из Friends отменяет fetch и ожидание retry, но оставляет загруженные заявки.
        return () => controller.abort();
    }, [direction, authenticatedRequest, isEnabled, reloadVersion]);

    // Получает нажатие Retry после окончательной ошибки.
    // Меняет номер загрузки, чтобы effect запустил новую ограниченную серию.
    // Повторяет только этот список; второе направление и друзья не перезагружаются.
    const retryRequests = () => setReloadVersion((version) => version + 1);

    // ------- ПРИНЯТИЕ, ОТКЛОНЕНИЕ И ОТМЕНА -------
    // Получает заявку и действие; для исходящих разрешает только удаление.
    // Выполняет один POST/DELETE и после успеха убирает заявку из списка.
    // Возвращает true при успехе; при ошибке оставляет заявку и сохраняет текст рядом с ней.
    const submitFriendRequestAction = async (request: FriendRequest, action: FriendRequestAction) => {
        if (!isEnabled || isSubmittingActionRef.current) return false;
        if (direction === "outgoing" && action === "accept") return false;
        // Ref блокирует второе нажатие сразу, до рендера disabled-кнопок.
        isSubmittingActionRef.current = true;
        setPendingAction({ requestId: request.id, action });
        setActionError(null);
        try {
            if (action === "accept") await acceptFriendRequest(request.id, authenticatedRequest);
            else await deleteFriendRequest(request.id, authenticatedRequest);

            resolvedRequestIdsDuringLoadRef.current.add(request.id);
            setRequests(
                (previousRequests) => previousRequests?.filter((item) => item.id !== request.id) ?? null,
            );
            return true;
        } catch (error) {
            setActionError({
                requestId: request.id,
                message: error instanceof Error ? error.message : "Failed to update friend request",
            });
            return false;
        } finally {
            isSubmittingActionRef.current = false;
            setPendingAction(null);
        }
    };

    return {
        requests: requests ?? [],
        hasLoaded: requests !== null,
        isLoading,
        error,
        requestRetry,
        retryRequests,
        pendingAction,
        actionError,
        submitFriendRequestAction,
    };
};
