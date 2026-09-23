import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { search } from "../controllers/user.controller.js";
// api/users/

export const userRouter = Router();

userRouter.get("/search", authMiddleware, search);
