// Вызывается в начале одной отправки сообщения.
// Запоминает длительность этапов и общее время работы sendMessage.
// Возвращает запись этапа и вывод одного dev-лога; содержимое сообщения и токены не логирует.
export const createMessageSendTiming = () => {
    const enabled = process.env.NODE_ENV !== "production";
    const startedAt = performance.now();
    let stageStartedAt = startedAt;
    const stages: Record<string, number> = {};

    // Получает название завершённого этапа, например checksMs или createMs.
    // Сохраняет время с предыдущей отметки и начинает отсчёт следующего этапа.
    // Меняет только локальные замеры; в production ничего не делает.
    const recordStage = (name: string) => {
        if (!enabled) return;
        const now = performance.now();
        stages[name] = Math.round(now - stageStartedAt);
        stageStartedAt = now;
    };

    // Вызывается при завершении sendMessage, в том числе после ошибки или раннего return.
    // Добавляет общее время к собранным этапам и выводит один объект в консоль.
    // В production не выводит лог и не меняет результат отправки.
    const finish = () => {
        if (!enabled) return;
        console.debug("[message:send]", { ...stages, totalMs: Math.round(performance.now() - startedAt) });
    };

    return { recordStage, finish };
};
