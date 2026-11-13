import { LoaderCircle, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../../features/auth/useAuth";
import type { Conversation } from "../../../features/conversations/conversations.types";
import { useOpenDirectConversation } from "../../../features/conversations/useOpenDirectConversation";
import { useFriends } from "../../../features/friends/useFriends";
import { useFriendRequests } from "../../../features/friends/useFriendRequests";
import type {
    Friend,
    FriendRequest,
    FriendRequestAction,
    FriendRequestDirection,
} from "../../../features/friends/friends.types";
import { MessengerMobileNav } from "../MessengerMobileNav";
import type { MessengerSection } from "../NavRail";
import { RequestRetryStatus } from "../RequestRetryStatus";
import { FriendRow } from "./FriendRow";
import { FriendRemoveDialog } from "./FriendRemoveDialog";
import { FriendRequestsList } from "./FriendRequestsList";

type FriendsPanelProps = {
    isActive: boolean;
    conversations: Conversation[];
    onSelectSection: (section: MessengerSection) => void;
    onConversationReady: (conversation: Conversation) => void;
};

const friendLists = [
    { id: "friends", label: "Friends" },
    { id: "incoming", label: "Incoming" },
    { id: "outgoing", label: "Outgoing" },
] as const;

// Получает активность раздела, диалоги и обработчики навигации.
// Сохраняет список между переходами, открывает DIRECT и подтверждает удаление друга.
// Возвращает панель Friends; API и состояние списка остаются в отдельных хуках.
export const FriendsPanel = ({
    isActive, // открыт ли раздел
    conversations,
    onSelectSection,
    onConversationReady,
}: FriendsPanelProps) => {
    const { authenticatedRequest } = useAuth();
    const {
        friends,
        hasLoaded,
        isLoading,
        error,
        requestRetry,
        retryFriends,
        addFriendToList,
        removeFriendFromList,
    } = useFriends(authenticatedRequest, isActive);
    // friends/incoming/outgoing
    const [activeList, setActiveList] = useState<"friends" | FriendRequestDirection>("friends");
    // Оба направления загружаются независимо при входе в Friends; смена списка не запускает GET.
    const incomingRequests = useFriendRequests("incoming", authenticatedRequest, isActive);
    const outgoingRequests = useFriendRequests("outgoing", authenticatedRequest, isActive);
    const requestLists = { incoming: incomingRequests, outgoing: outgoingRequests };
    // Счетчики
    // До первой успешной загрузки не показываем ложный ноль во вкладке.
    const listCounts = {
        friends: hasLoaded ? friends.length : null,
        incoming: incomingRequests.hasLoaded ? incomingRequests.requests.length : null,
        outgoing: outgoingRequests.hasLoaded ? outgoingRequests.requests.length : null,
    };
    // указывает на объект выбранного направления
    const activeRequests = activeList === "friends" ? null : requestLists[activeList];
    // отвечает за loader в header(идёт фоновое обновление)
    const isRefreshing = activeRequests
        ? activeRequests.hasLoaded && activeRequests.isLoading
        : hasLoaded && isLoading;
    const headingRef = useRef<HTMLHeadingElement>(null);

    // ------- ДЕЙСТВИЯ С ЗАЯВКАМИ -------
    // Получает заявку и действие из видимого списка Incoming или Outgoing.
    // Дожидается обработки в его хуке; после принятия добавляет пользователя в Friends.
    // Обновляет оба списка локально, даже если за время POST переключили вкладку.
    const handleFriendRequestAction = async (request: FriendRequest, action: FriendRequestAction) => {
        if (!activeRequests) return; // если открыто friends, то будет null
        const isCompleted = await activeRequests.submitFriendRequestAction(request, action);
        if (isCompleted && action === "accept") addFriendToList(request.user);
    };

    // ------- ОТКРЫТИЕ ПЕРЕПИСКИ -------
    const {
        openingUserId,
        openingError,
        openConversationForUser,
        cancelOpeningConversation,
        resetConversationOpening,
    } = useOpenDirectConversation({
        isEnabled: isActive,
        conversations,
        authenticatedRequest,
        onConversationReady,
    });
    useEffect(() => {
        if (isActive) resetConversationOpening();
        // Уход в Chats отменяет незавершённый POST и не позволяет позднему ответу выбрать чат.
        return cancelOpeningConversation;
    }, [isActive, resetConversationOpening, cancelOpeningConversation]);

    // ------- ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ -------
    const [friendToRemove, setFriendToRemove] = useState<Friend | null>(null);
    const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false);

    // Получает друга из меню строки.
    // Сохраняет его снимок и открывает подтверждение.
    // Снимок остаётся после закрытия, чтобы текст не исчезал во время exit-анимации.
    const confirmFriendRemoval = (friend: Friend) => {
        setFriendToRemove(friend);
        setIsRemoveDialogOpen(true);
    };

    return (
        <section className="flux-friends-panel" aria-labelledby="friends-title">
            <header className="flex shrink-0 items-center gap-3 border-b border-blue-100/70 px-5 py-5 dark:border-white/7 lg:px-8">
                <h1
                    ref={headingRef}
                    tabIndex={-1}
                    id="friends-title"
                    className="min-w-0 flex-1 text-xl font-semibold tracking-tight outline-none"
                >
                    Friends
                </h1>
                {isRefreshing && (
                    <LoaderCircle
                        size={15}
                        className="shrink-0 animate-spin text-slate-400 motion-reduce:animate-none"
                        aria-label="Refreshing list"
                    />
                )}
            </header>

            <nav className="shrink-0 px-4 pt-4 lg:px-8" aria-label="Friend lists">
                <div className="flux-friends-tabs">
                    {friendLists.map(({ id, label }) => (
                        <button
                            key={id}
                            type="button"
                            className="flux-friends-tab"
                            aria-pressed={activeList === id}
                            onClick={() => setActiveList(id)}
                        >
                            {/* У подписи и счётчика общая базовая линия текста. */}
                            <span className="inline-flex items-baseline gap-1.5">
                                {label}
                                {listCounts[id] !== null && (
                                    <span className="flux-friends-tab-count">{listCounts[id]}</span>
                                )}
                            </span>
                        </button>
                    ))}
                </div>
            </nav>

            <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 lg:p-8"
                aria-busy={activeRequests?.isLoading ?? isLoading}
            >
                <div className="flux-friends-list-view" hidden={activeList !== "friends"}>
                    {(requestRetry || error) && (
                        <div className={hasLoaded ? "mb-3" : "flex min-h-48 items-center justify-center"}>
                            <RequestRetryStatus retry={requestRetry} error={error} onRetry={retryFriends} />
                        </div>
                    )}
                    {openingError && (
                        <RequestRetryStatus
                            retry={null}
                            error={openingError.message}
                            onRetry={() => void openConversationForUser(openingError.userId)}
                        />
                    )}
                    {!hasLoaded && !requestRetry && !error && (
                        <div className="flux-conversation-state min-h-48 gap-2" role="status">
                            <LoaderCircle
                                size={18}
                                className="animate-spin motion-reduce:animate-none"
                                aria-hidden="true"
                            />
                            Loading friends…
                        </div>
                    )}
                    {hasLoaded &&
                        (friends.length === 0 ? (
                            <div
                                className="flex min-h-64 flex-col items-center justify-center gap-3 px-4 text-center"
                                role="status"
                            >
                                <UsersRound
                                    size={34}
                                    strokeWidth={1.4}
                                    className="text-blue-300 dark:text-slate-600"
                                    aria-hidden="true"
                                />
                                <div>
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                                        No friends yet
                                    </p>
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                        Your friends will appear here.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <ul className="mx-auto max-w-3xl space-y-2" aria-label="Friends">
                                {friends.map((friend) => (
                                    <FriendRow
                                        key={friend.id}
                                        friend={friend}
                                        isOpening={openingUserId === friend.id}
                                        actionsDisabled={openingUserId !== null}
                                        onOpenConversation={openConversationForUser}
                                        onRemoveFriend={confirmFriendRemoval}
                                    />
                                ))}
                            </ul>
                        ))}
                </div>
                {activeRequests && activeList !== "friends" && (
                    <FriendRequestsList
                        key={activeList}
                        direction={activeList}
                        {...activeRequests}
                        onRequestAction={handleFriendRequestAction}
                    />
                )}
            </div>

            <MessengerMobileNav activeSection="friends" onSelectSection={onSelectSection} />
            <FriendRemoveDialog
                friend={friendToRemove}
                isOpen={isRemoveDialogOpen}
                onOpenChange={setIsRemoveDialogOpen}
                onRemove={removeFriendFromList}
                onRestoreFocus={() => headingRef.current?.focus({ preventScroll: true })}
            />
        </section>
    );
};
