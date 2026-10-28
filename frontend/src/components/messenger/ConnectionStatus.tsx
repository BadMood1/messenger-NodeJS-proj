import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import type { RealtimeConnectionStatus } from "../../features/realtime/useRealtimeConnection";

type VisibleConnectionStatus = Exclude<RealtimeConnectionStatus, "connected">;

const CONNECTION_NOTICE_DELAY_MS = 400;

const connectionLabels: Record<VisibleConnectionStatus, string> = {
    connecting: "Connecting to FLUX…",
    reconnecting: "Reconnecting to FLUX…",
    offline: "No internet connection",
};

// Получает статус существующего realtime-соединения.
// Показывает спокойный индикатор после короткой паузы; offline сообщает без ожидания.
// При восстановлении плавно скрывается, сохраняя текст на время выхода.
export const ConnectionStatus = ({ status }: { status: RealtimeConnectionStatus }) => {
    const [notice, setNotice] = useState<{ status: VisibleConnectionStatus; isVisible: boolean }>({
        status: "connecting",
        isVisible: false,
    });

    useEffect(() => {
        // Короткий reconnect при смене JWT не должен мигать в интерфейсе.
        // Если индикатор скрыт, перед показом connecting/reconnecting ждём 400 мс.
        const shouldDelayNotice = !notice.isVisible && (status === "connecting" || status === "reconnecting");
        // Для offline, скрытия и обновления уже видимого индикатора задержку не добавляем.
        const delay = shouldDelayNotice ? CONNECTION_NOTICE_DELAY_MS : 0;
        const timerId = window.setTimeout(() => {
            setNotice((previousNotice) => {
                // Если соединение восстановлено, скрываем индикатор.
                // Прежний status сохраняем, чтобы текст не менялся во время анимации исчезновения.
                if (status === "connected") {
                    return previousNotice.isVisible ? { ...previousNotice, isVisible: false } : previousNotice;
                }
                // Если этот статус уже показан, оставляем прежний state.
                if (previousNotice.status === status && previousNotice.isVisible) return previousNotice;
                // Иначе показываем индикатор с текущим статусом.
                return { status, isVisible: true };
            });
        }, delay);

        // При смене status/видимости или удалении компонента отменяем предыдущий таймер.
        // Если подключились раньше 400 мс, ожидающее уведомление уже не появится.
        return () => window.clearTimeout(timerId);
    }, [status, notice.isVisible]);

    return (
        <div className="flux-connection-status" data-visible={notice.isVisible}
            role="status" aria-live="polite" aria-atomic="true" aria-hidden={!notice.isVisible}>
            {notice.status === "offline" ? (
                <WifiOff size={15} strokeWidth={1.8} aria-hidden="true" />
            ) : (
                <span className="flux-connection-loader" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </span>
            )}
            <span>{connectionLabels[notice.status]}</span>
        </div>
    );
};
