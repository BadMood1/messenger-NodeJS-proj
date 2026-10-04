export type RefreshAccessToken = () => Promise<string | null>;

export type AuthenticatedRequest = (input: string | URL, init?: RequestInit) => Promise<Response>;

// Выполняет fetch с Bearer access token.
// При 401 получает через callback актуальный токен и один раз повторяет исходный запрос.
// Если токен получить не удалось, возвращает исходный 401 без бесконечных retry.
export const requestWithAuth = async (
    input: string | URL,
    init: RequestInit | undefined,
    accessToken: string,
    refreshAccessToken: RefreshAccessToken,
) => {
    // Делаем исходный запрос с переданным access token.
    const execute = (token: string) => {
        const headers = new Headers(init?.headers);

        // Добавляем JWT в Authorization header.
        headers.set("Authorization", `Bearer ${token}`);

        return fetch(input, {
            ...init,
            headers,
        });
    };

    // Первый запрос отправляем с текущим access token.
    const response = await execute(accessToken);

    // Если токен валидный и 401 (Unauthorized) нет — просто возвращаем ответ.
    if (response.status !== 401) {
        return response;
    }

    // Если получили 401 — пытаемся получить актуальный access token.
    const newAccessToken = await refreshAccessToken();

    // Если обновить токен не удалось — возвращаем исходный 401.
    if (!newAccessToken) {
        return response;
    }

    // Повторяем исходный запрос один раз уже с новым токеном.
    return execute(newAccessToken);
};
