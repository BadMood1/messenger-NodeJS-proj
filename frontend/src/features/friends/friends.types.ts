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
