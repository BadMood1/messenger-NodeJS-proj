import { prisma } from "../lib/prisma.js";
import { AppError } from "../errors/app-error.js";
import { Prisma } from "../generated/prisma/client.js";
import {
    publishFriendRequestCreated,
    publishFriendRequestAccepted,
    publishFriendRequestRemoved,
    publishFriendshipRemoved,
} from "../realtime/socket-friendships.js";

const publicFriendProfileSelect = { id: true, name: true, username: true, image: true } as const;

// Получает id двух участников дружбы.
// Одним SELECT загружает их публичные профили и проверяет, что оба пользователя существуют.
// Возвращает sender и receiver для события, не загружая связи после записи в БД.
const getFriendshipParticipants = async (senderId: string, receiverId: string) => {
    const users = await prisma.user.findMany({
        where: { id: { in: [senderId, receiverId] } },
        select: publicFriendProfileSelect,
    });
    const sender = users.find((user) => user.id === senderId);
    const receiver = users.find((user) => user.id === receiverId);
    if (!sender || !receiver) throw new AppError(404, "User not found");
    return { sender, receiver };
};

// Получает ошибку условного UPDATE или DELETE Friendship.
// Проверяет P2025: записи с указанными id и статусом больше нет.
// Возвращает true, если другое действие успело изменить или удалить эту связь.
const isFriendshipAlreadyChanged = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

// Получает id отправителя из авторизации и id получателя из URL.
// Проверяет пользователей и отсутствие связи, сохраняет заявку и публикует её после INSERT.
// Возвращает прежний REST-ответ Friendship; socket получает публичные профили обеих сторон.
export const sendFriendRequest = async (senderId: string, receiverId: string) => {
    if (senderId === receiverId) {
        throw new AppError(400, "You cannot add yourself as a friend");
    }

    // Одним чтением получаем оба профиля; проверку существующей связи запускаем параллельно.
    const [participants, existingFriendship] = await Promise.all([
        getFriendshipParticipants(senderId, receiverId),
        prisma.friendship.findFirst({
            where: {
                OR: [
                    { senderId, receiverId },
                    { senderId: receiverId, receiverId: senderId },
                ],
            },
            select: { id: true },
        }),
    ]);
    if (existingFriendship) {
        throw new AppError(409, "Friendship already exists");
    }

    const friendship = await prisma.friendship.create({
        data: {
            senderId,
            receiverId,
        },
    });
    // socket publish
    // До успешного INSERT событие не отправляем; профили уже получены выше.
    publishFriendRequestCreated({ ...friendship, ...participants });
    return friendship;
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

// Получает id заявки и id текущего пользователя.
// Проверяет получателя, переводит только PENDING в ACCEPTED и уведомляет обе стороны.
// Возвращает принятую Friendship; проигравший параллельный Accept/Cancel получает 409.
export const acceptFriendRequest = async (requestId: string, userId: string) => {
    const request = await prisma.friendship.findUnique({
        where: { id: requestId },
        // Профили нужны для socket. Читаем их вместе с заявкой до UPDATE.
        relationLoadStrategy: "join",
        select: {
            status: true,
            receiverId: true,
            sender: { select: publicFriendProfileSelect },
            receiver: { select: publicFriendProfileSelect },
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

    try {
        // Если заявку успели отменить или принять, условие PENDING уже не выполнится.
        const friendship = await prisma.friendship.update({
            where: { id: requestId, status: "PENDING", receiverId: userId },
            data: { status: "ACCEPTED" },
        });
        publishFriendRequestAccepted({ ...friendship, sender: request.sender, receiver: request.receiver });
        return friendship;
    } catch (error) {
        if (isFriendshipAlreadyChanged(error)) throw new AppError(409, "Friend request is no longer pending");
        throw error;
    }
};

// ОТКЛОНИТЬ ЗАПРОС

// Получает id заявки и id текущего пользователя.
// Проверяет участника и удаляет только PENDING, затем уведомляет обе стороны.
// Завершает удаление; если заявку уже приняли параллельно, возвращает 409.
export const deleteFriendRequest = async (requestId: string, userId: string) => {
    try {
        // Удалять заявку может только отправитель или получатель.
        // ACCEPTED удаляется через отдельный removeFriend().
        const deletedRequest = await prisma.friendship.delete({
            where: {
                id: requestId,
                status: "PENDING",
                OR: [{ senderId: userId }, { receiverId: userId }],
            },
        });
        publishFriendRequestRemoved(deletedRequest);
        return;
    } catch (error) {
        if (!isFriendshipAlreadyChanged(error)) throw error;
    }

    // Ищем конкретную заявку только если DELETE не нашёл подходящую запись.
    const request = await prisma.friendship.findUnique({
        where: { id: requestId },
        select: { senderId: true, receiverId: true },
    });

    if (!request) {
        throw new AppError(404, "Friend request not found");
    }

    const isParticipant = request.senderId === userId || request.receiverId === userId;

    if (!isParticipant) {
        throw new AppError(403, "Forbidden");
    }

    throw new AppError(409, "Friend request is not pending");
};

// Получить список друзей

export const getFriends = async (userId: string) => {
    const friendships = await prisma.friendship.findMany({
        where: {
            status: "ACCEPTED",
            OR: [{ senderId: userId }, { receiverId: userId }],
        },

        select: {
            senderId: true,
            sender: {
                select: publicFriendProfileSelect,
            },

            receiver: {
                select: publicFriendProfileSelect,
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
// Получает id текущего пользователя и удаляемого друга.
// Находит принятую связь, удаляет её и уведомляет обе стороны.
// Возвращает удалённую Friendship, чтобы REST и socket ссылались на одну связь.
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
        select: { id: true },
    });

    if (!friendship) {
        throw new AppError(404, "Friendship not found");
    }

    try {
        const deletedFriendship = await prisma.friendship.delete({
            where: { id: friendship.id, status: "ACCEPTED" },
        });
        publishFriendshipRemoved(deletedFriendship);
        return deletedFriendship;
    } catch (error) {
        if (isFriendshipAlreadyChanged(error)) throw new AppError(404, "Friendship not found");
        throw error;
    }
};
