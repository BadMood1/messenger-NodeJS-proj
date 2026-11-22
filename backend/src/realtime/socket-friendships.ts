import type { Friendship, User } from "../generated/prisma/client.js";
import { publishToUser } from "./socket.js";

type FriendRequestParticipant = Pick<User, "id" | "name" | "username" | "image">;
type CreatedFriendRequest = Pick<Friendship, "id" | "createdAt"> & {
    sender: FriendRequestParticipant;
    receiver: FriendRequestParticipant;
};

type RemovedFriendship = Pick<Friendship, "id" | "createdAt" | "senderId" | "receiverId">;

// Получает сохранённую заявку и публичные профили отправителя и получателя.
// Отправляет получателю входящую заявку, а отправителю — исходящую с тем же id.
// В поле user каждой стороне передаёт другого участника; события получают все её вкладки.
export const publishFriendRequestCreated = ({ id, createdAt, sender, receiver }: CreatedFriendRequest) => {
    publishToUser(receiver.id, "friend-request:created", {
        direction: "incoming",
        request: { id, createdAt, user: sender },
    });
    publishToUser(sender.id, "friend-request:created", {
        direction: "outgoing",
        request: { id, createdAt, user: receiver },
    });
};

// Получает принятую заявку и публичные профили её участников.
// Уведомляет обе стороны о принятии, передавая каждой профиль нового друга.
// Позволяет убрать заявку и добавить друга одним событием во всех вкладках.
export const publishFriendRequestAccepted = ({ id, createdAt, sender, receiver }: CreatedFriendRequest) => {
    publishToUser(sender.id, "friendship:changed", {
        type: "accepted", requestId: id, createdAt, friend: receiver,
    });
    publishToUser(receiver.id, "friendship:changed", {
        type: "accepted", requestId: id, createdAt, friend: sender,
    });
};

// Получает удалённую входящую или исходящую заявку.
// Отправляет обеим сторонам её id и id другого пользователя.
// Убирает заявку при отклонении или отмене без загрузки списков заново.
export const publishFriendRequestRemoved = ({ id, createdAt, senderId, receiverId }: RemovedFriendship) => {
    publishToUser(senderId, "friendship:changed", {
        type: "request-removed", requestId: id, createdAt, userId: receiverId,
    });
    publishToUser(receiverId, "friendship:changed", {
        type: "request-removed", requestId: id, createdAt, userId: senderId,
    });
};

// Получает удалённую принятую дружбу.
// Уведомляет обе стороны об id удалённой связи и другом пользователе.
// Позволяет убрать друга и отличить старую дружбу от новой между теми же пользователями.
export const publishFriendshipRemoved = ({ id, createdAt, senderId, receiverId }: RemovedFriendship) => {
    publishToUser(senderId, "friendship:changed", {
        type: "friend-removed", friendshipId: id, createdAt, userId: receiverId,
    });
    publishToUser(receiverId, "friendship:changed", {
        type: "friend-removed", friendshipId: id, createdAt, userId: senderId,
    });
};
