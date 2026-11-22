import type { UserFriendshipStatus } from "../friends/friends.types";

export type UserSearchResult = {
    id: string;
    name: string;
    username: string;
    image: string | null;
    friendshipStatus: UserFriendshipStatus;
};
