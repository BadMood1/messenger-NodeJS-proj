import { z } from "zod";

export const sendMessageSchema = z.object({
    content: z.string().trim().min(1, "Message cannot be empty").max(4000, "Message is too long"),
    replyToId: z.string().uuid().optional(),
    clientMessageId: z.string().uuid().optional(), // UUID с frontend; без него старые запросы тоже работают
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// Получает query-параметры загрузки истории.
// Проверяет режим, направление, limit и согласованность полей cursor.
// Возвращает параметры с defaults или ошибки для противоречивых комбинаций.
export const messageHistoryQuerySchema = z
    .object({
        // от какой позиции продолжать историю
        // cursor = id самого старого сообщения, которое уже есть у клиента (при direction=older).
        cursor: z.string().uuid().optional(),
        // Вместе с id дата задаёт позицию даже после удаления самого сообщения.
        cursorCreatedAt: z.string().datetime({ offset: true }).optional(),
        // older - загрузить перед указанной позицией; newer - после неё. На клиенте выбирается
        direction: z.enum(["older", "newer"]).default("older"),
        // latest - покажи конец переписки; unread - покажи возле непрочитанных
        mode: z.enum(["latest", "unread"]).default("latest"),

        // Сколько сообщений грузим за один запрос
        // z.coerce.number() преобразует значение через Number(), а z.number() не принимает строку "123" как число
        limit: z.coerce.number().int().min(1).max(50).default(30),
    })
    // Поля по отдельности могут проходить, но их сочетания неправильные
    // query - проверяемый объект с уже применёнными преобразованиями
    // ctx - предоставленный Zod объект для работы с дополнительными ошибками проверки
    .superRefine((query, ctx) => {
        // дата курсора без id
        if (query.cursorCreatedAt && !query.cursor) {
            // добавляем ошибки проверки
            ctx.addIssue({
                code: "custom", // код ошибки
                path: ["cursorCreatedAt"], // к какому полю относим ошибку
                message: "cursorCreatedAt requires cursor", // текст ошибки
            });
        }
        // newer без позиции
        if (query.direction === "newer" && !query.cursor) {
            ctx.addIssue({
                code: "custom",
                path: ["direction"],
                message: "Loading newer messages requires cursor",
            });
        }
        // одновременно unread и cursor
        if (query.mode === "unread" && query.cursor) {
            ctx.addIssue({
                code: "custom",
                path: ["mode"],
                message: "Unread mode is only for the initial window",
            });
        }
    });

export const editMessageSchema = z.object({
    // После trim пустое сообщение не разрешаем
    content: z.string().trim().min(1, "Message cannot be empty").max(4000, "Message is too long"),
});
