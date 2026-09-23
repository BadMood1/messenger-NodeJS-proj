import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";

export const sendFriendRequest = async (senderId: string, receiverId: string) => {
    if (senderId === receiverId) {
        throw new AppError(400, "You cannot add yourself as a friend");
    }

    const receiver = await prisma.user.findUnique({
        where: {
            id: receiverId,
        },
        select: {
            id: true,
        },
    });

    if (!receiver) {
        throw new AppError(404, "User not found");
    }

    const existingFriendship = await prisma.friendship.findFirst({
        where: {
            OR: [
                {
                    senderId,
                    receiverId,
                },
                {
                    senderId: receiverId,
                    receiverId: senderId,
                },
            ],
        },
    });

    if (existingFriendship) {
        throw new AppError(409, "Friendship already exists");
    }

    return prisma.friendship.create({
        data: {
            senderId,
            receiverId,
        },
    });
};

// Получить входящие запросы в друзья
export const getIncomingFriendRequests = async (userId: string) => {
    return prisma.friendship.findMany({
        where: {
            receiverId: userId,
            status: "PENDING",
        },

        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },
        },

        orderBy: {
            createdAt: "desc",
        },
    });
};

// ПРИНЯТЬ ЗАПРОС

export const acceptFriendRequest = async (requestId: string, userId: string) => {
    const request = await prisma.friendship.findUnique({
        where: {
            id: requestId,
        },
    });

    if (!request) {
        throw new AppError(404, "Friend request not found");
    }

    if (request.receiverId !== userId) {
        throw new AppError(403, "Forbidden");
    }

    if (request.status !== "PENDING") {
        throw new AppError(409, "Friend request is not pending");
    }

    return prisma.friendship.update({
        where: {
            id: requestId,
        },
        data: {
            status: "ACCEPTED",
        },
    });
};

// ОТКЛОНИТЬ ЗАПРОС

export const deleteFriendRequest = async (requestId: string, userId: string) => {
    // Ищем конкретную заявку
    const request = await prisma.friendship.findUnique({
        where: {
            id: requestId,
        },
    });

    if (!request) {
        throw new AppError(404, "Friend request not found");
    }

    // Удалять заявку может только отправитель или получатель
    const isParticipant = request.senderId === userId || request.receiverId === userId;

    if (!isParticipant) {
        throw new AppError(403, "Forbidden");
    }

    // ACCEPTED удаляется через отдельный removeFriend()
    // Здесь работаем только с заявками
    if (request.status !== "PENDING") {
        throw new AppError(409, "Friend request is not pending");
    }

    await prisma.friendship.delete({
        where: {
            id: requestId,
        },
    });
};

// Получить список друзей

export const getFriends = async (userId: string) => {
    const friendships = await prisma.friendship.findMany({
        where: {
            status: "ACCEPTED",
            OR: [{ senderId: userId }, { receiverId: userId }],
        },

        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },

            receiver: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },
        },

        orderBy: {
            updatedAt: "desc",
        },
    });

    return friendships.map((friendship) => {
        return friendship.senderId === userId ? friendship.receiver : friendship.sender;
    }); // чтобы не возвращать лишние данные наши
};

// Получить исходящие запросы в друзья
export const getOutgoingFriendRequests = async (userId: string) => {
    return prisma.friendship.findMany({
        where: {
            senderId: userId,
            status: "PENDING",
        },

        include: {
            receiver: {
                select: {
                    id: true,
                    name: true,
                    username: true,
                    image: true,
                },
            },
        },

        orderBy: {
            createdAt: "desc",
        },
    });
};

// Удалить друга
export const removeFriend = async (currentUserId: string, friendId: string) => {
    const friendship = await prisma.friendship.findFirst({
        where: {
            status: "ACCEPTED",
            OR: [
                {
                    senderId: currentUserId,
                    receiverId: friendId,
                },
                {
                    senderId: friendId,
                    receiverId: currentUserId,
                },
            ],
        },
    });

    if (!friendship) {
        throw new AppError(404, "Friendship not found");
    }

    await prisma.friendship.delete({
        where: {
            id: friendship.id,
        },
    });
};
