export type UserSearchResult = {
    id: string;
    name: string;
    username: string;
    image: string | null;
    friendshipStatus: "NONE" | "PENDING_SENT" | "PENDING_RECEIVED" | "FRIENDS";
};
