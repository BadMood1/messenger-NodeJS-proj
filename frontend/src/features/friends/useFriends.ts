import { useCallback, useEffect, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { requestWithRetry, type RequestRetryState } from "../../lib/request-retry";
import { getFriends } from "./friends.api";
import type { Friend } from "./friends.types";

// Получает защищённый request и признак открытого раздела Friends.
// Загружает список с ограниченными повторами, сохраняя прежние данные при смене раздела.
// Возвращает друзей, состояния загрузки/ошибки, ручной Retry и локальное добавление/удаление.
export const useFriends = (authenticatedRequest: AuthenticatedRequest, isEnabled: boolean) => {
    // null — успешной загрузки ещё не было; [] — уже получили настоящий пустой список.
    const [friends, setFriends] = useState<Friend[] | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [requestRetry, setRequestRetry] = useState<RequestRetryState | null>(null);
    const [reloadVersion, setReloadVersion] = useState(0);
    // Во время GET чтобы не потерялись действия
    // Значение Friend — добавили друга; null — удалили. Запоминаем изменения для текущего GET.
    const friendChangesDuringLoadRef = useRef(new Map<string, Friend | null>());

    // ------- ЗАГРУЗКА СПИСКА -------
    useEffect(() => {
        if (!isEnabled) return;
        const controller = new AbortController();
        const friendChangesDuringLoad = new Map<string, Friend | null>();
        friendChangesDuringLoadRef.current = friendChangesDuringLoad;

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
                const unchangedFriends = result.filter((friend) => !friendChangesDuringLoad.has(friend.id));
                // Если приняли заявку во время GET, ставим добавленных друзей перед старым списком.
                const addedFriends = [...friendChangesDuringLoad.values()]
                    .filter((friend) => friend !== null)
                    .reverse();
                setFriends([...addedFriends, ...unchangedFriends]);
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

    // ------- ЛОКАЛЬНОЕ ДОБАВЛЕНИЕ И УДАЛЕНИЕ -------
    // Получает пользователя после успешного принятия входящей заявки.
    // Добавляет его первым без дубля; если первый GET ещё идёт, сохраняет добавление для его ответа.
    // Обновляет загруженный список друзей без нового запроса.
    const addFriendToList = useCallback((friend: Friend) => {
        friendChangesDuringLoadRef.current.set(friend.id, friend);
        setFriends((previousFriends) => {
            // Если полный список ещё не загрузился, не подменяем его одним новым другом.
            if (previousFriends === null) return null;
            return [friend, ...previousFriends.filter((item) => item.id !== friend.id)];
        });
    }, []);

    // Получает id друга после успешного DELETE или socket-события.
    // Исключает пользователя из списка и запоминает удаление для текущего GET.
    // Обновляет UI без запроса; REST вызывает общий обработчик в useFriendshipLists.
    const removeFriendFromList = useCallback((userId: string) => {
        friendChangesDuringLoadRef.current.set(userId, null);
        setFriends((previousFriends) => previousFriends?.filter((friend) => friend.id !== userId) ?? null);
    }, []);

    return {
        friends: friends ?? [],
        hasLoaded: friends !== null,
        isLoading,
        error,
        requestRetry,
        retryFriends,
        addFriendToList,
        removeFriendFromList,
    };
};
