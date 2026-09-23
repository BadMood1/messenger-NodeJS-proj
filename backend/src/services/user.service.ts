import { prisma } from "../lib/prisma.js";

export const searchUsers = async (query: string, currentUserId: string) => {
    const users = await prisma.user.findMany({
        where: {
            id: {
                not: currentUserId,
            },

            username: {
                contains: query,
                mode: "insensitive",
            },
        },

        select: {
            id: true,
            name: true,
            username: true,
            image: true,

            // Этот пользователь отправлял заявку мне ?
            sentFriendships: {
                where: {
                    receiverId: currentUserId,
                },
                select: {
                    status: true,
                },
            },

            // Я отправлял заявку этому пользователю ?
            receivedFriendships: {
                where: {
                    senderId: currentUserId,
                },
                select: {
                    status: true,
                },
            },
        },

        take: 20,
    });

    return users.map((user) => {
        // Связь, где найденный пользователь отправлял заявку текущему пользователю.
        // Берём [0], т.к. это массив, а взяли одну нужную
        const sentByUser = user.sentFriendships[0];

        // Связь, где текущий пользователь отправлял заявку найденному пользователю.
        const sentByMe = user.receivedFriendships[0];

        // По умолчанию между пользователями никаких отношений нет.
        let friendshipStatus: "NONE" | "PENDING_SENT" | "PENDING_RECEIVED" | "FRIENDS" = "NONE";

        // Если в любом направлении Friendship уже ACCEPTED,
        // значит пользователи друзья.
        if (sentByUser?.status === "ACCEPTED" || sentByMe?.status === "ACCEPTED") {
            friendshipStatus = "FRIENDS";
        }

        // Если заявку отправил текущий пользователь,
        // на фронте можно показать "Заявка отправлена".
        else if (sentByMe?.status === "PENDING") {
            friendshipStatus = "PENDING_SENT";
        }

        // Если заявку отправил найденный пользователь,
        // на фронте можно показать "Принять заявку".
        else if (sentByUser?.status === "PENDING") {
            friendshipStatus = "PENDING_RECEIVED";
        }

        // Убираем sentFriendships и receivedFriendships (не нужны на front'е)
        const { sentFriendships, receivedFriendships, ...publicUser } = user;

        return {
            ...publicUser,
            friendshipStatus,
        };
    });
};
