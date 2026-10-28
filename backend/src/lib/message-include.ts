// Preview содержит только один уровень: replyTo исходного сообщения не загружаем.
export const messageInclude = {
    sender: {
        select: {
            id: true,
            name: true,
            username: true,
            image: true,
        },
    },
    replyTo: {
        select: {
            id: true,
            content: true,
            updatedAt: true, // Дата оригинала позволяет frontend сравнить свежесть цитаты без загрузки самого сообщения.
            sender: { select: { id: true, name: true, username: true } },
        },
    },
} as const;
