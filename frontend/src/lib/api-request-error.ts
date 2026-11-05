// Получает понятное сообщение и HTTP-статус; null означает, что ответа сервера не было.
// Сохраняет причину сбоя для обработчиков запросов.
// Позволяет отличить временную потерю связи от отказа в доступе или неверных данных.
export class ApiRequestError extends Error {
    readonly status: number | null;
    readonly retryAfterMs?: number;

    constructor(message: string, status: number | null, retryAfterMs?: number) {
        super(message); // вызываем конструктор Error и ниже расширяем его поля
        this.name = "ApiRequestError";
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

// Получает ошибку запроса.
// Проверяет сетевой сбой и HTTP-статусы, для которых возможен успешный повтор.
// Возвращает true только для временной ошибки.
export const isTemporaryRequestError = (error: unknown) =>
    error instanceof TypeError ||
    (error instanceof ApiRequestError &&
        (error.status === null ||
            error.status === 408 ||
            error.status === 429 ||
            (error.status >= 500 && error.status < 600)));

// Получает неуспешный HTTP-ответ и запасной текст.
// Читает сообщение backend и Retry-After, сохраняя исходный HTTP-статус.
// Возвращает ошибку, по которой общий retry отличает временный сбой от отказа.
// request-retry.ts использует её для повторов
export const createApiRequestError = async (response: Response, fallback: string) => {
    let message = fallback;
    try {
        const body = (await response.json()) as { error?: string };
        message = body.error ?? fallback;
    } catch {
        // Если backend вернул не JSON, оставляем понятную ошибку по умолчанию.
    }
    // Проверяем попросил ли сервер подождать перед повтором
    const retryAfter = response.headers.get("Retry-After");
    let retryAfterMs: number | undefined;
    if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
    }
    return new ApiRequestError(message, response.status, retryAfterMs);
};
