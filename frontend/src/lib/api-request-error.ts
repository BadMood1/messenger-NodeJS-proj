// Получает понятное сообщение и HTTP-статус; null означает, что ответа сервера не было.
// Сохраняет причину сбоя для обработчиков запросов.
// Позволяет отличить временную потерю связи от отказа в доступе или неверных данных.
export class ApiRequestError extends Error {
    readonly status: number | null;

    constructor(message: string, status: number | null) {
        super(message);
        this.name = "ApiRequestError";
        this.status = status;
    }
}

// Получает ошибку запроса.
// Проверяет сетевой сбой и HTTP-статусы, для которых возможен успешный повтор.
// Возвращает true только для временной ошибки.
export const isTemporaryRequestError = (error: unknown) =>
    error instanceof TypeError ||
    (error instanceof ApiRequestError &&
        (error.status === null || error.status === 408 || error.status === 429 ||
            (error.status >= 500 && error.status < 600)));
