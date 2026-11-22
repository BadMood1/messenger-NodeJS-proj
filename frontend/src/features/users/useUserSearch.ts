import { useEffect, useState } from "react";

import { requestWithRetry, type RequestRetryState } from "../../lib/request-retry";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { searchUsers } from "./users.api";
import type { UserSearchResult } from "./users.types";

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_CHARACTERS = 2;

type UserSearchState = {
    searchQuery: string;
    users: UserSearchResult[];
    isLoading: boolean;
    error: string | null;
    requestRetry: RequestRetryState | null;
    requestStartedAt: number;
};

type UseUserSearchOptions = {
    query: string;
    isEnabled: boolean;
    authenticatedRequest: AuthenticatedRequest;
};

// Получает введённый username, признак открытого окна и защищённый request.
// Ждёт паузу во вводе, загружает пользователей и отменяет поиск при смене запроса/закрытии.
// Возвращает результаты текущего запроса, состояния загрузки и ручной Retry.
export const useUserSearch = ({ query, isEnabled, authenticatedRequest }: UseUserSearchOptions) => {
    // обрабатываем текст из Input из NewConversationDialog
    const normalizedSearchQuery = query.trim().replace(/^@/, "").toLowerCase();
    const isSearchQueryLongEnough = normalizedSearchQuery.length >= MIN_SEARCH_CHARACTERS;
    const [searchState, setSearchState] = useState<UserSearchState | null>(null);
    const [retryVersion, setRetryVersion] = useState(0);

    // ------- ПОИСК ПОСЛЕ ПАУЗЫ ВО ВВОДЕ -------
    useEffect(() => {
        if (!isEnabled || !isSearchQueryLongEnough) return;
        const controller = new AbortController();

        // Получает запрос из текущего effect после окончания debounce.
        // Загружает пользователей через общую политику ограниченных повторов.
        // Сохраняет результат или ошибку, только если этот поиск ещё не отменён.
        const loadUsers = async () => {
            let requestStartedAt = performance.now();
            setSearchState({
                searchQuery: normalizedSearchQuery,
                users: [],
                isLoading: true,
                error: null,
                requestRetry: null,
                requestStartedAt,
            });
            try {
                const users = await requestWithRetry(
                    () => {
                        // Каждая попытка GET получает своё время начала для сравнения с live-изменениями.
                        requestStartedAt = performance.now();
                        return searchUsers(normalizedSearchQuery, authenticatedRequest, {
                            signal: controller.signal,
                        });
                    },
                    {
                        signal: controller.signal,
                        // Если GET вернул временную ошибку, показываем Retry с обратным отсчётом.
                        onRetryState: (requestRetry) => {
                            if (controller.signal.aborted) return;
                            setSearchState((previous) =>
                                previous ? { ...previous, requestRetry } : previous,
                            );
                        },
                    },
                );
                if (controller.signal.aborted) return;
                setSearchState({
                    searchQuery: normalizedSearchQuery,
                    users,
                    isLoading: false,
                    error: null,
                    requestRetry: null,
                    requestStartedAt,
                });
            } catch (error) {
                if (controller.signal.aborted) return;
                setSearchState({
                    searchQuery: normalizedSearchQuery,
                    users: [],
                    isLoading: false,
                    error: error instanceof Error ? error.message : "Failed to search users",
                    requestRetry: null,
                    requestStartedAt,
                });
            }
        };

        const timerId = window.setTimeout(() => void loadUsers(), SEARCH_DEBOUNCE_MS);
        return () => {
            // Следующий ввод или закрытие окна отменяет и debounce, и текущий GET/ожидание Retry.
            window.clearTimeout(timerId);
            controller.abort();
        };
    }, [normalizedSearchQuery, isSearchQueryLongEnough, isEnabled, authenticatedRequest, retryVersion]);

    // ------- РЕЗУЛЬТАТЫ ТЕКУЩЕГО ВВОДА -------
    // Если username изменился, скрываем предыдущие результаты сразу, до выполнения нового effect.
    const currentSearchState = searchState?.searchQuery === normalizedSearchQuery ? searchState : null;

    // Получает нажатие Retry после окончательной ошибки поиска.
    // Очищает прежний результат и запускает новую ограниченную серию для текущего username.
    // Переводит UI в загрузку; сам GET выполняет effect выше.
    const retryUserSearch = () => {
        setSearchState(null);
        setRetryVersion((version) => version + 1);
    };

    // Получает новое открытие окна или очистку поискового поля.
    // Убирает сохранённый результат предыдущего поиска.
    // Следующий ввод ожидает свежий GET вместо краткого показа старого списка.
    const clearUserSearchResults = () => setSearchState(null);

    return {
        users: isSearchQueryLongEnough ? (currentSearchState?.users ?? []) : [],
        isLoading: isSearchQueryLongEnough && (!currentSearchState || currentSearchState.isLoading),
        error: isSearchQueryLongEnough ? (currentSearchState?.error ?? null) : null,
        requestRetry: isSearchQueryLongEnough ? (currentSearchState?.requestRetry ?? null) : null,
        isSearchQueryLongEnough,
        retryUserSearch,
        clearUserSearchResults,
        requestStartedAt: currentSearchState?.requestStartedAt ?? 0,
    };
};
