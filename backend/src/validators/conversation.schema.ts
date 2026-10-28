import { z } from "zod";

export const conversationParamsSchema = z.object({
    conversationId: z.string().uuid(),
});

export const markConversationReadSchema = z.object({
    messageId: z.string().uuid(),
}).strict();
