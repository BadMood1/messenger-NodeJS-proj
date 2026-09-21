import type { ErrorRequestHandler } from "express";

import { ZodError } from "zod";
import { AppError } from "../errors/app-error.js";

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    // Наши контролируемые ошибки
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: err.message,
        });

        return;
    }

    // Ошибка входных данных от Zod
    if (err instanceof ZodError) {
        res.status(400).json({
            error: "Invalid input",
            details: err.issues,
        });

        return;
    }

    // Всё неожиданное
    console.error(err);

    res.status(500).json({
        error: "Internal server error",
    });
};
