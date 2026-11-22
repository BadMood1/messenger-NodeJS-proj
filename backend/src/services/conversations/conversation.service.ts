import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { loadDirectConversationResponses } from "./direct-conversation-response.js";

// Получает id текущего пользователя и собеседника.
// Если DM уже был — возвращает существующий. Если не было — создаёт и возвращает новый
// Возвращает готовый диалог в том же формате, что GET списка, с preview и прочтением.
export const getOrCreateDirectConversation = async (currentUserId: string, otherUserId: string) => {
    // Самому себе чат пока не создаём
    if (currentUserId === otherUserId) {
        throw new AppError(400, "You cannot create a conversation with yourself");
    }

    // Проверяем, что пользователь существует
    const otherUser = await prisma.user.findUnique({
        where: {
            id: otherUserId,
        },
        select: {
            id: true,
        },
    });

    if (!otherUser) {
        throw new AppError(404, "User not found");
    }

    // Сортируем id, чтобы для одной пары всегда был один ключ
    const directKey = [currentUserId, otherUserId].sort().join(":");

    // Если чат уже есть — получим его, иначе создадим
    const conversation = await prisma.conversation.upsert({
        where: {
            directKey,
        },

        update: {},

        create: {
            type: "DIRECT",
            directKey,

            members: {
                create: [{ userId: currentUserId }, { userId: otherUserId }],
            },
        },

        select: { id: true },
    });

    // деструкт. массив, получ. 1ый элемент
    const [conversationResponse] = await loadDirectConversationResponses(currentUserId, conversation.id);
    // Если диалог исчез между upsert и чтением ответа, возвращаем 404.
    if (!conversationResponse) throw new AppError(404, "Conversation not found");
    return conversationResponse;
};

// Получает id текущего пользователя.
// Загружает его DIRECT-диалоги, собеседников, последние сообщения и метаданные прочтения.
// Возвращает список от новых к старым с readState, peerReadState и unreadCount.
export const getDirectConversations = async (userId: string) => {
    return loadDirectConversationResponses(userId);
};
