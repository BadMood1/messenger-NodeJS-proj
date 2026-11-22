import { useCallback, useRef, useState } from "react";

import type { AuthenticatedRequest } from "../auth/authenticated-request";
import { removeFriend } from "./friends.api";
import type {
    FriendRequest,
    FriendRequestAction,
    FriendRequestCreatedEvent,
    FriendRequestDirection,
    FriendshipChangedEvent,
    FriendshipStatusChange,
    UserFriendshipStatus,
} from "./friends.types";
import { useFriends } from "./useFriends";
import { useFriendRequests } from "./useFriendRequests";

type UseFriendshipListsOptions = {
    authenticatedRequest: AuthenticatedRequest;
    isEnabled: boolean;
};

// Получает защищённый request и признак авторизации в Messenger.
// объединяет три списка Friends
export const useFriendshipLists = ({ authenticatedRequest, isEnabled }: UseFriendshipListsOptions) => {
    // ------- СОСТОЯНИЕ СПИСКОВ -------
    // друзья, загрузка/ошибка списка, функция добавления и удаления друга
    const friendsState = useFriends(authenticatedRequest, isEnabled);
    // входящие и исходящие заявки + действия с ними
    const incomingRequests = useFriendRequests("incoming", authenticatedRequest, isEnabled);
    const outgoingRequests = useFriendRequests("outgoing", authenticatedRequest, isEnabled);
    const retryFriends = friendsState.retryFriends;
    const retryIncomingRequests = incomingRequests.retryRequests;
    const retryOutgoingRequests = outgoingRequests.retryRequests;

    // Получает сигнал подключения socket или конфликт отношений при отправке новой заявки из поиска.
    // Перечитывает друзей и оба направления заявок через существующие загрузчики.
    // Согласует списки с backend; успешная отправка использует локальное добавление без этих GET.
    const syncFriendshipLists = useCallback(() => {
        retryFriends();
        retryIncomingRequests();
        retryOutgoingRequests();
    }, [retryFriends, retryIncomingRequests, retryOutgoingRequests]);

    const addIncomingRequest = incomingRequests.addFriendRequestToList;
    const addOutgoingRequest = outgoingRequests.addFriendRequestToList;
    const removeIncomingRequest = incomingRequests.removeFriendRequestFromList;
    const removeOutgoingRequest = outgoingRequests.removeFriendRequestFromList;
    const addFriendToList = friendsState.addFriendToList;
    const removeFriendFromList = friendsState.removeFriendFromList;

    // ------ Доп. хранилища ------
    // последние полученные изменения отношений по userId
    const [friendshipChangesByUserId, setFriendshipChangesByUserId] = useState(
        new Map<string, FriendshipStatusChange>(),
    );
    // копия этих изменений для UI
    const friendshipChangesRef = useRef(new Map<string, FriendshipStatusChange>());
    // id завершенных удалением связей(скипаем запоздавшие события создания)
    const removedFriendshipIdsRef = useRef(new Set<string>());

    // ------- АКТУАЛЬНЫЕ ОТНОШЕНИЯ ДЛЯ СОБЫТИЙ И ПОИСКА -------
    // запоминает актуальный статус отношений с user'ом и не даёт запоздавшим события переписать его
    // false если не запомнили изменение
    const rememberFriendshipStatus = useCallback(
        (
            userId: string,
            friendshipId: string | null,
            createdAt: string | null,
            status: UserFriendshipStatus,
        ) => {
            if (friendshipId && status !== "NONE" && removedFriendshipIdsRef.current.has(friendshipId))
                return false;
            const previousChange = friendshipChangesRef.current.get(userId);
            // Если уже знаем более новую связь с этим пользователем, старое событие не применяем.
            if (
                previousChange?.createdAt &&
                createdAt &&
                Date.parse(previousChange.createdAt) > Date.parse(createdAt)
            )
                return false;
            if (previousChange?.friendshipId === friendshipId) {
                if (previousChange.status === status || previousChange.status === "NONE") return false;
                if (previousChange.status === "FRIENDS" && status !== "NONE") return false;
            }
            const change = { friendshipId, createdAt, status, receivedAt: performance.now() };
            friendshipChangesRef.current.set(userId, change);
            setFriendshipChangesByUserId(new Map(friendshipChangesRef.current));
            return true;
        },
        [],
    );

    // Получает friend-request:created с направлением и заявкой в формате списка.
    // Передаёт incoming во входящие, outgoing — в исходящие, включая скрытую панель Friends.
    // Обновляет список без GET; стабильная ссылка не переподключает socket при изменении счётчиков.
    const handleFriendRequestCreated = useCallback(
        (event: FriendRequestCreatedEvent) => {
            const status = event.direction === "incoming" ? "PENDING_RECEIVED" : "PENDING_SENT";
            if (
                !rememberFriendshipStatus(
                    event.request.user.id,
                    event.request.id,
                    event.request.createdAt,
                    status,
                )
            )
                return;
            if (event.direction === "incoming") addIncomingRequest(event.request);
            else addOutgoingRequest(event.request);
        },
        [addIncomingRequest, addOutgoingRequest, rememberFriendshipStatus],
    );

    // ------- ПРИНЯТИЕ И УДАЛЕНИЕ ЧЕРЕЗ ОБЩИЙ ОБРАБОТЧИК -------
    // Получает принятие заявки, её отклонение/отмену или удаление дружбы. friendship:changed
    // Убирает завершённую заявку из обоих направлений и меняет список друзей и статус поиска.
    // Применяет REST и socket одинаково; старое подтверждение не возвращает удалённую дружбу.
    const handleFriendshipChanged = useCallback(
        (event: FriendshipChangedEvent) => {
            const friendshipId = event.type === "friend-removed" ? event.friendshipId : event.requestId;
            const userId = event.type === "accepted" ? event.friend.id : event.userId;
            removeIncomingRequest(friendshipId);
            removeOutgoingRequest(friendshipId);

            // Если это удаление уже применили, повтор не должен затронуть новую связь с тем же пользователем.
            if (event.type !== "accepted" && removedFriendshipIdsRef.current.has(friendshipId)) return;
            if (event.type === "accepted") {
                if (rememberFriendshipStatus(userId, friendshipId, event.createdAt, "FRIENDS"))
                    addFriendToList(event.friend);
                return;
            }
            // Отклонение старой заявки не меняет уже подтверждённую дружбу с тем же id.
            const previousChange = friendshipChangesRef.current.get(userId);
            if (
                event.type === "request-removed" &&
                previousChange?.friendshipId === friendshipId &&
                previousChange.status === "FRIENDS"
            )
                return;
            removedFriendshipIdsRef.current.add(friendshipId);
            if (!rememberFriendshipStatus(userId, friendshipId, event.createdAt, "NONE")) return;
            if (event.type === "friend-removed") removeFriendFromList(userId);
        },
        [
            removeIncomingRequest,
            removeOutgoingRequest,
            addFriendToList,
            removeFriendFromList,
            rememberFriendshipStatus,
        ],
    );

    // Получает исходящую заявку из успешного POST.
    // Передаёт её тому же обработчику, который принимает friend-request:created.
    // Обновляет Outgoing и статус поиска без отдельного локального Set отправленных пользователей.
    const handleOutgoingRequestSent = useCallback(
        (request: FriendRequest) => {
            handleFriendRequestCreated({ direction: "outgoing", request });
        },
        [handleFriendRequestCreated],
    );

    // Получает id получателя и локальное время начала POST.
    // Проверяет, подтвердил ли socket исходящую заявку или дружбу после начала этой отправки.
    // Возвращает true, чтобы потерянный HTTP-ответ не показывал ложную ошибку отправки.
    const hasConfirmedOutgoingRequestSince = useCallback((userId: string, requestStartedAt: number) => {
        const change = friendshipChangesRef.current.get(userId);
        return Boolean(
            change &&
            change.receivedAt >= requestStartedAt &&
            (change.status === "PENDING_SENT" || change.status === "FRIENDS"),
        );
    }, []);

    // Получает направление списка, заявку и выбранное действие из панели.
    // выполнить Accept, Decline или Cancel
    // Обновляет локальные списки и без socket; ошибки остаются в соответствующем request-хуке.
    const performFriendRequestAction = async (
        direction: FriendRequestDirection,
        request: FriendRequest,
        action: FriendRequestAction,
    ) => {
        const requestList = direction === "incoming" ? incomingRequests : outgoingRequests;
        // если действие неуспешно, то прекращаем
        if (!(await requestList.submitFriendRequestAction(request, action))) return;
        // применяем успешное действие
        handleFriendshipChanged(
            action === "accept"
                ? {
                      type: "accepted",
                      requestId: request.id,
                      createdAt: request.createdAt,
                      friend: request.user,
                  }
                : {
                      type: "request-removed",
                      requestId: request.id,
                      createdAt: request.createdAt,
                      userId: request.user.id,
                  },
        );
    };

    // Получает id друга после подтверждения удаления в модалке.
    // Выполняет DELETE и передаёт серверный id связи общему обработчику; 404 тоже убирает старую запись.
    // При ошибке сохраняет друга и передаёт ошибку модалке; новый socket-статус за время 404 не стирает.
    const removeFriendAndSyncState = async (userId: string) => {
        const changeBeforeRequest = friendshipChangesRef.current.get(userId);
        const removal = await removeFriend(userId, authenticatedRequest);
        if (removal) {
            handleFriendshipChanged(removal);
        } else if (friendshipChangesRef.current.get(userId) === changeBeforeRequest) {
            // Если backend уже не нашёл дружбу и за время DELETE не пришло новое событие, убираем старую строку.
            removeFriendFromList(userId);
            if (changeBeforeRequest?.friendshipId)
                removedFriendshipIdsRef.current.add(changeBeforeRequest.friendshipId);
            rememberFriendshipStatus(
                userId,
                changeBeforeRequest?.friendshipId ?? null,
                changeBeforeRequest?.createdAt ?? null,
                "NONE",
            );
        }
    };

    return {
        friendsState,
        incomingRequests,
        outgoingRequests,
        syncFriendshipLists,
        friendshipChangesByUserId,
        handleFriendRequestCreated,
        handleFriendshipChanged,
        handleOutgoingRequestSent,
        hasConfirmedOutgoingRequestSince,
        performFriendRequestAction,
        removeFriendAndSyncState,
    };
};

export type FriendshipLists = ReturnType<typeof useFriendshipLists>;
