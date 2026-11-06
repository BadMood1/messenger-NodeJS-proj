import { LoaderCircle, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "../../../features/auth/useAuth";
import type { Conversation } from "../../../features/conversations/conversations.types";
import { useOpenDirectConversation } from "../../../features/conversations/useOpenDirectConversation";
import { useFriends } from "../../../features/friends/useFriends";
import type { Friend } from "../../../features/friends/friends.types";
import { MessengerMobileNav } from "../MessengerMobileNav";
import type { MessengerSection } from "../NavRail";
import { RequestRetryStatus } from "../RequestRetryStatus";
import { FriendRow } from "./FriendRow";
import { FriendRemoveDialog } from "./FriendRemoveDialog";

type FriendsPanelProps = {
    isActive: boolean;
    conversations: Conversation[];
    onSelectSection: (section: MessengerSection) => void;
    onConversationReady: (conversation: Conversation) => void;
};

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
    const { friends, hasLoaded, isLoading, error, requestRetry, retryFriends, removeFriendFromList } =
        useFriends(authenticatedRequest, isActive);
    const headingRef = useRef<HTMLHeadingElement>(null);

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

    // const friends: Friend[] = [
    //     {
    //         id: "test123",
    //         name: "testFriend",
    //         username: "testfriend",
    //         image: null,
    //     },
    // ];

    return (
        <section className="flux-friends-panel" aria-labelledby="friends-title">
            <header className="flex shrink-0 items-center gap-3 border-b border-blue-100/70 px-5 py-4 dark:border-white/7 lg:px-8 lg:py-6">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-500 dark:bg-blue-400/10 dark:text-cyan-300">
                    <UsersRound size={22} strokeWidth={1.7} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                    <h1
                        ref={headingRef}
                        tabIndex={-1}
                        id="friends-title"
                        className="text-lg font-semibold tracking-tight outline-none"
                    >
                        Friends
                    </h1>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Your friends on FLUX</p>
                </div>
                {hasLoaded && (
                    <span
                        className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium tabular-nums text-blue-600 dark:bg-blue-400/10 dark:text-cyan-300"
                        aria-label={`${friends.length} ${friends.length === 1 ? "friend" : "friends"}`}
                    >
                        Friends: {friends.length}
                    </span>
                )}
                {hasLoaded && isLoading && (
                    <LoaderCircle
                        size={15}
                        className="shrink-0 animate-spin text-slate-400 motion-reduce:animate-none"
                        aria-label="Refreshing friends"
                    />
                )}
            </header>

            <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 lg:p-8"
                aria-busy={isLoading}
            >
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
