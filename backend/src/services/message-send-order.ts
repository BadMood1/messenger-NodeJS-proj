import type { Prisma } from "../generated/prisma/client.js";
import type { messageInclude } from "../lib/message-include.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";

// для каждой отправки создаём общее ожидание её результата.
// Следующее сообщение ждёт это ожидание и только после успеха сохраняется само.

type SavedMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
type PreviousMessage = Pick<SavedMessage, "createdAt">;
type SendOrder = {
    conversationId: string;
    senderId: string;
    clientMessageId?: string | undefined;
    previousClientMessageId?: string | undefined;
};
type SendCompletion = {
    promise: Promise<SavedMessage>;
    resolve: (message: SavedMessage) => void;
    reject: (error: unknown) => void;
    isStarted: boolean;
    isSettled: boolean; // получен окончательный результат
};

const PREVIOUS_SEND_TIMEOUT_MS = 10_000;
const COMPLETED_SEND_CACHE_MS = 60_000;
// Общая таблица текущего backend-процесса: зависимости работают и между разными HTTP-запросами.
const sendCompletions = new Map<string, SendCompletion>();

// Получает ключ отправки: chat1:user1:A
// Возвращает существующее ожидание или создаёт его до прихода запроса-предшественника.
// Все запросы, зависящие от одной отправки, ждут один Promise.
const getSendCompletion = (key: string) => {
    const existing = sendCompletions.get(key);
    if (existing) return existing;
    // если записи нет, создаём промис
    let resolve!: SendCompletion["resolve"];
    let reject!: SendCompletion["reject"];
    const promise = new Promise<SavedMessage>((resolvePromise, rejectPromise) => {
        // resolve и reject сохраняем в замыкании, чтобы их можно было вызвать позже.
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    // Ошибка отправки допустима и без ожидающих последующих сообщений.
    void promise.catch(() => {});
    // собираем объект ожидания
    const completion = { promise, resolve, reject, isStarted: false, isSettled: false };
    sendCompletions.set(key, completion);
    return completion;
};

// Получает ключ отправки и завершённое ожидание.
// Оставляет результат или ошибку в таблице на минуту для следующих сообщений серии.
// Затем удаляет именно эту запись; повторная попытка с тем же ключом не затрагивается.
const scheduleSendCleanup = (key: string, completion: SendCompletion) => {
    setTimeout(() => {
        if (sendCompletions.get(key) === completion) sendCompletions.delete(key);
    }, COMPLETED_SEND_CACHE_MS).unref();
};

// Получает автора, чат и clientMessageId предшественника.
// Ищет сохранённую запись этого автора и проверяет её принадлежность текущему чату.
// Возвращает дату записи или null, если она ещё не сохранена.
const findSavedPreviousMessage = async (order: SendOrder, previousId: string) => {
    const saved = await prisma.message.findUnique({
        where: { senderId_clientMessageId: { senderId: order.senderId, clientMessageId: previousId } },
        select: { createdAt: true, conversationId: true },
    });
    if (saved && saved.conversationId !== order.conversationId) {
        throw new AppError(400, "Previous message must belong to this conversation");
    }
    return saved;
};

// Получает данные автора, чата и id предыдущей отправки.
// Ждёт её сохранения и публикации; после перезапуска может найти уже сохранённую запись в БД.
// Возвращает её дату или завершает ожидание ошибкой максимум через 10 секунд.
const waitForPreviousMessage = async (order: SendOrder): Promise<PreviousMessage | null> => {
    const previousId = order.previousClientMessageId;
    if (!previousId) return null;
    const key = `${order.conversationId}:${order.senderId}:${previousId}`;
    let previousMessageCompletion = sendCompletions.get(key);
    if (!previousMessageCompletion) {
        // Ищем предыдущее сообщ. в БД
        const saved = await findSavedPreviousMessage(order, previousId);
        if (saved) return saved;
        // Если не сохранено - создаём ожидание для этого предыдущего сообщ. (А)
        previousMessageCompletion = getSendCompletion(key);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        // ---- Ждём завершения предыдущего сообщения (A) или таймаута 10 секунд. ----
        return await Promise.race([
            // когда Promise A получит результат, тогда продолжим выполнение этой функции
            // обработчик сообщ. А вызывает resolve/resolve, а обработчик сообщ. B ждёт его promise здесь
            previousMessageCompletion.promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    const error = new AppError(409, "Previous message was not confirmed. Retry sending.");
                    // Если сам предыдущий запрос не пришёл, убираем его пустое ожидание из таблицы.
                    if (
                        !previousMessageCompletion.isStarted &&
                        sendCompletions.get(key) === previousMessageCompletion
                    ) {
                        sendCompletions.delete(key);
                        previousMessageCompletion.reject(error);
                    }
                    reject(error);
                }, PREVIOUS_SEND_TIMEOUT_MS);
            }),
        ]);
    } catch (error) {
        // Если ответ INSERT потерялся, запись могла сохраниться: БД важнее запомненной ошибки.
        const saved = await findSavedPreviousMessage(order, previousId);
        if (saved) return saved;
        throw error;
    } finally {
        clearTimeout(timer);
    }
};

// Получает проверенную отправку и функцию сохранения с публикацией socket-события.
// Выполняет её после предыдущей отправки; одновременные дубли используют один результат.
// Возвращает сохранённое сообщение и ненадолго сохраняет результат для следующих запросов.
export const sendMessageInOrder = async (
    order: SendOrder, // данные отправки B, которая должна идти после А
    // ф-ция соранения текущ. сообщ. и публикации socket-события
    saveAndPublish: (previous: PreviousMessage | null) => Promise<SavedMessage>,
) => {
    if (!order.clientMessageId) return saveAndPublish(null);
    const key = `${order.conversationId}:${order.senderId}:${order.clientMessageId}`;
    // Сервис уже проверил БД: если записи нет, старый cache не должен вернуть удалённое сообщение.
    if (sendCompletions.get(key)?.isSettled) sendCompletions.delete(key);

    const completion = getSendCompletion(key);
    if (!completion.isStarted) {
        completion.isStarted = true;
        void (async () => {
            try {
                // дожидаемся предыдущего сообщения
                const previous = await waitForPreviousMessage(order);
                // сохранить и опубликовать текущее
                const message = await saveAndPublish(previous);
                completion.isSettled = true;
                completion.resolve(message);
                // Последующие запросы серии получают результат без повторного чтения БД(минуту после)
                scheduleSendCleanup(key, completion);
            } catch (error) {
                completion.isSettled = true;
                completion.reject(error);
                scheduleSendCleanup(key, completion);
            }
        })();
    }
    return completion.promise;
};

// Получает отправку, которая завершилась ошибкой ещё на проверках.
// Отклоняет ожидание её последующих сообщений, если сохранение ещё не было запущено.
// Запоминает ошибку для последующих запросов; Retry создаст новое ожидание с тем же clientMessageId.
export const rejectPendingMessageSend = (order: SendOrder, error: unknown) => {
    if (!order.clientMessageId) return;
    const key = `${order.conversationId}:${order.senderId}:${order.clientMessageId}`;
    const completion = getSendCompletion(key);
    if (!completion.isStarted && !completion.isSettled) {
        completion.isSettled = true;
        completion.reject(error);
        scheduleSendCleanup(key, completion);
    }
};
