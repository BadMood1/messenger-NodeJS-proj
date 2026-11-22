import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { requestWithRetry, type RequestRetryState } from "../../lib/request-retry";
import { acceptFriendRequest, deleteFriendRequest, getFriendRequests } from "./friends.api";
import type { FriendRequest, FriendRequestAction, FriendRequestDirection } from "./friends.types";

// Получает массив заявок из GET, POST или socket.
// Сортирует по дате от новых к старым; при одинаковой дате сравнивает id.
// Возвращает новый массив, не меняя исходный список.
const sortFriendRequestsByDate = (requests: FriendRequest[]) => requests.toSorted((first, second) =>
    Date.parse(second.createdAt) - Date.parse(first.createdAt) || first.id.localeCompare(second.id));

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
    // Значение FriendRequest — добавили заявку; null — убрали. Изменения относятся к текущему GET.
    const requestChangesDuringLoadRef = useRef(new Map<string, FriendRequest | null>());
    // Если заявку уже убрали из списка, поздний created или ответ POST не должен вернуть её даже после нового GET.
    const removedRequestIdsRef = useRef(new Set<string>());

    // ------- ЗАГРУЗКА ОДНОГО НАПРАВЛЕНИЯ -------
    useEffect(() => {
        if (!isEnabled) return;
        const controller = new AbortController();
        const requestChangesDuringLoad = new Map<string, FriendRequest | null>();
        requestChangesDuringLoadRef.current = requestChangesDuringLoad;

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
                // Если заявку добавили или убрали во время GET, исключаем её старую версию из ответа.
                const unchangedRequests = result.filter((request) =>
                    !removedRequestIdsRef.current.has(request.id) && !requestChangesDuringLoad.has(request.id));
                // Берём добавленные заявки из Map; null означает удаление и в список не попадает.
                const addedRequests = [...requestChangesDuringLoad.values()].filter((request) => request !== null);
                setRequests(sortFriendRequestsByDate([...addedRequests, ...unchangedRequests]));
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

    // ------- ДОБАВЛЕНИЕ ЗАЯВКИ ИЗ POST ИЛИ SOCKET -------
    // Получает заявку этого направления после POST или friend-request:created.
    // Сохраняет её для текущего GET и обновляет список по id без дубля, сохраняя порядок дат.
    // Возвращает false, если заявку уже убрали; иначе true, даже если первый GET ещё загружается.
    const addFriendRequestToList = useCallback((request: FriendRequest) => {
        if (removedRequestIdsRef.current.has(request.id)) return false;
        requestChangesDuringLoadRef.current.set(request.id, request);
        setRequests((previousRequests) => previousRequests === null
            ? null
            : sortFriendRequestsByDate([request, ...previousRequests.filter((item) => item.id !== request.id)]));
        return true;
    }, []);

    // Получает id принятой, отклонённой или отменённой заявки из REST либо socket.
    // Запоминает удалённый id, убирает заявку из списка и защищает текущий GET от её возврата.
    // Обновляет только этот список; повторное событие с тем же id ничего не меняет.
    const removeFriendRequestFromList = useCallback((requestId: string) => {
        if (removedRequestIdsRef.current.has(requestId)) return;
        removedRequestIdsRef.current.add(requestId);
        requestChangesDuringLoadRef.current.set(requestId, null);
        setRequests((previousRequests) => {
            if (!previousRequests?.some((request) => request.id === requestId)) return previousRequests;
            return previousRequests.filter((request) => request.id !== requestId);
        });
    }, []);

    // ------- ПРИНЯТИЕ, ОТКЛОНЕНИЕ И ОТМЕНА -------
    // Получает заявку и действие; для исходящих разрешает только удаление.
    // Выполняет один POST/DELETE, отслеживает ожидание и сохраняет ошибку запроса.
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
        addFriendRequestToList,
        removeFriendRequestFromList,
        pendingAction,
        actionError,
        submitFriendRequestAction,
    };
};
