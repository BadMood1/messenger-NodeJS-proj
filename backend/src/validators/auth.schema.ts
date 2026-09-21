import { z } from "zod";

export const registerSchema = z.object({
    name: z.string().min(1),
    username: z.string().min(3).max(32),
    email: z.string().email(),
    password: z.string().min(8),
});

export type RegisterUserInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
    identifier: z.string().min(1),
    password: z.string().min(1),
});

export type LoginUserInput = z.infer<typeof loginSchema>;
