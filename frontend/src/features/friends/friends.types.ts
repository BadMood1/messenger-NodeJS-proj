export type Friend = {
    id: string;
    name: string;
    username: string;
    image: string | null;
};

export type FriendRequestDirection = "incoming" | "outgoing";
export type FriendRequestAction = "accept" | "delete";

// В UI user — собеседник: sender входящей заявки или receiver исходящей.
export type FriendRequest = {
    id: string;
    createdAt: string;
    user: Friend;
};

export type FriendRequestCreatedEvent = {
    direction: FriendRequestDirection;
    request: FriendRequest;
};

export type UserFriendshipStatus = "NONE" | "PENDING_SENT" | "PENDING_RECEIVED" | "FRIENDS";

export type FriendshipRemovedEvent = {
    type: "friend-removed";
    friendshipId: string;
    createdAt: string;
    userId: string;
};

export type FriendshipChangedEvent =
    | { type: "accepted"; requestId: string; createdAt: string; friend: Friend }
    | { type: "request-removed"; requestId: string; createdAt: string; userId: string }
    | FriendshipRemovedEvent;

// id и дата относятся к самой связи; receivedAt — локальное время получения изменения.
export type FriendshipStatusChange = {
    friendshipId: string | null;
    createdAt: string | null;
    status: UserFriendshipStatus;
    receivedAt: number;
};
