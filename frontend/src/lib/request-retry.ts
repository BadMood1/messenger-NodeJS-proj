import { ApiRequestError, isTemporaryRequestError } from "./api-request-error";

// Первый запрос + три повтора. Для другой операции можно передать свой массив задержек.
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000];
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export type RequestRetryState = {
    message: string;
    retryAt: number | null; // null — ждём восстановления сети, обратный отсчёт приостановлен
    retryNow: () => void;
};

type RetryOptions = {
    signal: AbortSignal;
    retryDelaysMs?: readonly number[];
    onRetryState: (state: RequestRetryState | null) => void;
};

// ------- ПОЛИТИКА ПОВТОРОВ -------
// Получает ошибку, число неудачных запросов и настройки задержек.
// Для временной ошибки выбирает следующий интервал, учитывая Retry-After сервера.
// Возвращает задержку либо null: ошибка окончательная или лимит повторов исчерпан.
export const getRequestRetryDelay = (
    error: unknown,
    failedAttempts: number,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
): number | null => {
    if (!isTemporaryRequestError(error)) return null;
    const delay = retryDelaysMs[failedAttempts - 1];
    if (delay === undefined) return null;
    // наша задержка или retryAfter сервера, если она есть и больше нашей
    return Math.max(delay, error instanceof ApiRequestError ? (error.retryAfterMs ?? 0) : 0);
};

// ------- ОДНА ПОПЫТКА С TIMEOUT -------
// Получает одну async-операцию, внешний signal и timeout.
// Передаёт ей отдельный signal и завершает ожидание при отмене или превышении времени.
// Возвращает результат одной попытки; timeout становится временной ошибкой 408.
export const runRequestAttempt = async <T>(
    request: (signal: AbortSignal) => Promise<T>,
    { signal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> => {
    signal?.throwIfAborted();
    const controller = new AbortController(); // отмен. для одной попытки
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    let rejectAttempt: (reason: unknown) => void = () => {};
    // Получает отмену от владельца загрузки.
    // Отменяет внутренний fetch и завершает ожидание той же причиной.
    // Не превращает смену чата или unmount в retry.
    const abortAttempt = () => {
        controller.abort(signal?.reason);
        rejectAttempt(signal?.reason);
    };
    // Промис, который завершится ошибкой при отмене или timeout
    const interrupted = new Promise<never>((_, reject) => {
        rejectAttempt = reject;
        signal?.addEventListener("abort", abortAttempt, { once: true });
        timeoutId = setTimeout(() => {
            reject(new ApiRequestError("Request timed out. Please try again.", 408));
            controller.abort();
        }, timeoutMs);
    });

    try {
        return await Promise.race([interrupted, request(controller.signal)]);
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abortAttempt);
    }
};

// ------- ОЖИДАНИЕ ТАЙМЕРА И ВОССТАНОВЛЕНИЯ СЕТИ -------
// Получает задержку, ошибку и signal текущей загрузки.
// Ждёт таймер или Retry now; offline приостанавливает ожидание до online.
// Завершает ожидание один раз и всегда убирает слушатели при отмене.
const waitForRequestRetry = (delayMs: number, error: unknown, { signal, onRetryState }: RetryOptions) =>
    new Promise<void>((resolve, reject) => {
        let timerId: ReturnType<typeof setTimeout> | undefined;
        const message = error instanceof Error ? error.message : "Unable to load data";

        const cleanup = () => {
            clearTimeout(timerId);
            window.removeEventListener("online", retryNow);
            window.removeEventListener("offline", pauseUntilOnline);
            signal.removeEventListener("abort", cancel);
        };
        // Получает сигнал таймера, Retry now или online.
        // Завершает ожидание, если браузер снова сообщает о доступной сети.
        // Разрешает одну следующую попытку в существующей серии.
        const retryNow = () => {
            if (!navigator.onLine) return;
            cleanup();
            resolve();
        };
        // Получает offline или начальное отсутствие сети.
        // Не расходует дополнительные попытки, пока запросов нет.
        const pauseUntilOnline = () => {
            clearTimeout(timerId);
            onRetryState({ message, retryAt: null, retryNow });
        };
        // Получает abort от владельца загрузки.
        const cancel = () => {
            cleanup();
            reject(signal.reason);
        };
        if (signal.aborted) return cancel();
        window.addEventListener("online", retryNow);
        window.addEventListener("offline", pauseUntilOnline);
        signal.addEventListener("abort", cancel, { once: true });
        if (!navigator.onLine) pauseUntilOnline();
        else {
            // показываем countdown
            onRetryState({ message, retryAt: Date.now() + delayMs, retryNow });
            timerId = setTimeout(retryNow, delayMs);
        }
    });

// ------- ОГРАНИЧЕННАЯ СЕРИЯ ЗАПРОСОВ -------
// Получает загрузку и настройки её ограниченных повторов.
// Повторяет только временные ошибки; отмена и окончательная ошибка завершают всю серию.
// Возвращает успешный результат либо последнюю ошибку; между попытками сообщает состояние для UI.
export const requestWithRetry = async <T>(request: () => Promise<T>, options: RetryOptions): Promise<T> => {
    const { signal, onRetryState, retryDelaysMs } = options;
    let failedAttempts = 0;
    try {
        for (;;) {
            signal.throwIfAborted();
            // если браузер офлайн - ждём онлайн
            if (!navigator.onLine) await waitForRequestRetry(0, null, options);
            signal.throwIfAborted();
            onRetryState(null); // убираем ожидание из интерфейса
            try {
                return await request();
            } catch (error) {
                signal.throwIfAborted();
                // Отмена чужого запроса не должна становиться новой автоматической попыткой.
                if (error instanceof DOMException && error.name === "AbortError") throw error;
                const delay = getRequestRetryDelay(error, ++failedAttempts, retryDelaysMs);
                if (delay === null) throw error;
                await waitForRequestRetry(delay, error, options); // новая итерация
            }
        }
    } finally {
        onRetryState(null);
    }
};
