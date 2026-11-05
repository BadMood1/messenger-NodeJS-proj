import { ArrowLeft, MoreHorizontal, Phone, Search, Video } from "lucide-react";

import type { Conversation } from "../../../features/conversations/conversations.types";
import { formatLastSeen } from "../../../features/realtime/format-last-seen";
import { getInitials } from "../../../lib/get-initials";

type ChatHeaderProps = {
    conversationUser: NonNullable<Conversation["user"]>;
    isPeerTyping: boolean;
    isPeerOnline: boolean | null;
    peerLastSeenAt: string | null;
    onBack: () => void;
};

// Получает собеседника, typing/presence и обработчик Back.
// Выбирает текст статуса и показывает avatar с текущим online-индикатором.
// Возвращает header чата с существующими кнопками и mobile Back.
export const ChatHeader = ({
    conversationUser,
    isPeerTyping,
    isPeerOnline,
    peerLastSeenAt,
    onBack,
}: ChatHeaderProps) => {
    // Пока presence неизвестен, оставляем username. Набор текста имеет приоритет над Online/Last seen.
    let statusText = `@${conversationUser.username}`;
    if (isPeerOnline !== null) statusText = isPeerOnline ? "Online" : formatLastSeen(peerLastSeenAt);
    if (isPeerTyping) statusText = "печатает…";

    return (
        <header className="flux-chat-header">
            <div className="flex items-center gap-3 max-lg:min-w-0 max-lg:gap-2">
                <button
                    type="button"
                    className="flux-icon-button lg:hidden"
                    aria-label="Back to conversations"
                    onClick={onBack}
                >
                    <ArrowLeft size={20} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <div className="relative shrink-0">
                    <div className="flux-chat-avatar overflow-hidden">
                        {conversationUser.image ? (
                            <img src={conversationUser.image} alt="" className="h-full w-full object-cover" />
                        ) : (
                            getInitials(conversationUser.name) || "?"
                        )}
                    </div>
                    {/* Показываем кружок только при подтверждённом online; null — статус ещё неизвестен. */}
                    {/* Оставляем элемент в DOM, чтобы opacity плавно менялась и при появлении, и при исчезновении. */}
                    <span
                        className="flux-presence-dot"
                        data-online={isPeerOnline === true}
                        aria-hidden="true"
                    />
                </div>
                <div className="max-lg:min-w-0">
                    <h2 className="text-base font-semibold leading-5 text-slate-900 dark:text-slate-50 max-lg:truncate">
                        {conversationUser.name}
                    </h2>
                    <p
                        aria-live="polite"
                        className={`mt-0.5 text-xs max-lg:truncate ${
                            isPeerTyping || isPeerOnline === true
                                ? "text-blue-600 dark:text-cyan-300"
                                : "text-slate-500 dark:text-slate-400"
                        }`}
                    >
                        {statusText}
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-1 max-lg:shrink-0">
                <button type="button" className="flux-icon-button max-lg:hidden" aria-label="Search chat">
                    <Search size={19} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-icon-button" aria-label="Call">
                    <Phone size={19} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-icon-button" aria-label="Video call">
                    <Video size={20} strokeWidth={1.8} aria-hidden="true" />
                </button>
                <button type="button" className="flux-icon-button" aria-label="More options">
                    <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true" />
                </button>
            </div>
        </header>
    );
};
