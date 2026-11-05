import { API_URL } from "../../lib/config";
import { createApiRequestError } from "../../lib/api-request-error";
import { runRequestAttempt } from "../../lib/request-retry";
import type { AuthenticatedRequest } from "../auth/authenticated-request";
import type { UserSearchResult } from "./users.types";

type SearchUsersResponse = {
    users: UserSearchResult[];
};

// Получает username, функцию защищённых запросов и signal отмены.
// Выполняет GET /users/search?q=... с общим timeout и обработкой HTTP-ошибок.
// Возвращает до 20 найденных пользователей из фактического ответа backend.
export const searchUsers = async (
    query: string,
    authenticatedRequest: AuthenticatedRequest,
    { signal }: { signal?: AbortSignal } = {},
): Promise<UserSearchResult[]> => {
    const params = new URLSearchParams({ q: query });
    return runRequestAttempt(
        async (requestSignal) => {
            const response = await authenticatedRequest(`${API_URL}/users/search?${params}`, {
                signal: requestSignal,
            });
            if (!response.ok) throw await createApiRequestError(response, "Failed to search users");
            const data = (await response.json()) as SearchUsersResponse;
            return data.users;
        },
        { signal },
    );
};
