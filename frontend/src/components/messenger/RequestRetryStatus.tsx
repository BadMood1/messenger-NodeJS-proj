import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";

import type { RequestRetryState } from "../../lib/request-retry";

// Получает время следующей попытки.
// Раз в секунду обновляет оставшееся ожидание; новая дата создаёт новый countdown через key.
// Возвращает короткий текст обратного отсчёта.
const RetryCountdown = ({ retryAt }: { retryAt: number }) => {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timerId = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timerId);
    }, []);
    return <>Retrying in {Math.max(0, Math.ceil((retryAt - now) / 1000))}…</>;
};

// Получает состояние автоматического повтора или окончательную ошибку и ручной Retry.
// Показывает ожидание сети, countdown либо сообщение после исчерпания попыток.
// Не отправляет запросы: кнопка вызывает обработчик владельца загрузки.
export const RequestRetryStatus = ({ retry, error, onRetry }: {
    retry: RequestRetryState | null;
    error?: string | null;
    onRetry: () => void;
}) => {
    if (!retry && !error) return null;
    const isWaitingForNetwork = retry?.retryAt === null;
    return (
        <div className={`flux-request-retry flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-3 py-2 text-center text-xs ${
            retry ? "text-slate-500 dark:text-slate-400" : "text-rose-600 dark:text-rose-300"
        }`} role={retry ? "status" : "alert"}>
            {isWaitingForNetwork ? <span>Waiting for a connection…</span> : <>
                <span>{retry?.message ?? error}</span>
                {retry?.retryAt != null && <span className="tabular-nums" aria-live="off">
                    <RetryCountdown key={retry.retryAt} retryAt={retry.retryAt} />
                </span>}
                <button type="button" onClick={retry?.retryNow ?? onRetry}
                    className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 font-semibold transition-colors duration-150 hover:bg-slate-500/10 active:bg-slate-500/15 motion-reduce:transition-none">
                    <RotateCw size={12} aria-hidden="true" /> {retry ? "Retry now" : "Retry"}
                </button>
            </>}
        </div>
    );
};
