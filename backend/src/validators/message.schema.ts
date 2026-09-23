import { z } from "zod";

export const sendMessageSchema = z.object({
    content: z.string().trim().min(1, "Message cannot be empty").max(4000, "Message is too long"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

//
export const messageHistoryQuerySchema = z.object({
    // cursor = id самого старого сообщения, которое уже есть у клиента
    cursor: z.string().uuid().optional(),

    // Сколько сообщений грузим за один запрос
    limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const editMessageSchema = z.object({
    // После trim пустое сообщение не разрешаем
    content: z.string().trim().min(1, "Message cannot be empty").max(4000, "Message is too long"),
});
