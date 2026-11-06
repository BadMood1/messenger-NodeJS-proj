import { useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { requestWithRetry, type RequestRetryState } from "../../lib/request-retry";
import { getFriends, removeFriend } from "./friends.api";
import type { Friend } from "./friends.types";

// Получает защищённый request и признак открытого раздела Friends.
// Загружает список с ограниченными повторами, сохраняя прежние данные при смене раздела.
// Возвращает друзей, состояния загрузки/ошибки, ручной Retry и удаление из списка.
export const useFriends = (authenticatedRequest: AuthenticatedRequest, isEnabled: boolean) => {
    // null — успешной загрузки ещё не было; [] — уже получили настоящий пустой список.
    const [friends, setFriends] = useState<Friend[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [requestRetry, setRequestRetry] = useState<RequestRetryState | null>(null);
    const [reloadVersion, setReloadVersion] = useState(0);
    const removedFriendIdsDuringLoadRef = useRef(new Set<string>());

    // ------- ЗАГРУЗКА СПИСКА -------
    useEffect(() => {
        if (!isEnabled) return;
        const controller = new AbortController();
        const removedFriendIdsDuringLoad = new Set<string>();
        removedFriendIdsDuringLoadRef.current = removedFriendIdsDuringLoad;

        // Получает запуск раздела или новую попытку загрузки.
        // Выполняет GET через общую политику retry и сохраняет успешный ответ.
        // Обновляет UI только пока эта загрузка не отменена.
        const loadFriends = async () => {
            setIsLoading(true);
            setError(null);
            setRequestRetry(null);
            try {
                const result = await requestWithRetry(
                    () => getFriends(authenticatedRequest, { signal: controller.signal }),
                    {
                        signal: controller.signal,
                        onRetryState: (retry) => {
                            if (!controller.signal.aborted) setRequestRetry(retry);
                        },
                    },
                );
                if (controller.signal.aborted) return;
                // Если DELETE завершился во время GET, старый ответ не возвращает друга в список.
                setFriends(result.filter((friend) => !removedFriendIdsDuringLoad.has(friend.id)));
            } catch (error) {
                if (controller.signal.aborted) return;
                setError(error instanceof Error ? error.message : "Failed to load friends");
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        };

        void loadFriends();
        // Уход в Chats отменяет и fetch, и таймер ожидающего повтора.
        return () => controller.abort();
    }, [authenticatedRequest, isEnabled, reloadVersion]);

    // Получает ручной Retry после окончательной ошибки.
    // Меняет номер загрузки, чтобы effect начал новую ограниченную серию.
    // Повторяет GET; сам обработчик не отправляет запрос.
    const retryFriends = () => setReloadVersion((version) => version + 1);

    // Получает id друга после подтверждения в модалке.
    // Удаляет дружбу через API и исключает пользователя из текущего списка.
    // Обновляет UI без GET; при ошибке оставляет список прежним и пробрасывает ошибку модалке.
    const removeFriendFromList = async (userId: string) => {
        await removeFriend(userId, authenticatedRequest);
        removedFriendIdsDuringLoadRef.current.add(userId);
        setFriends((previousFriends) => previousFriends?.filter((friend) => friend.id !== userId) ?? null);
    };

    return { friends: friends ?? [], hasLoaded: friends !== null, isLoading, error, requestRetry, retryFriends, removeFriendFromList };
};
