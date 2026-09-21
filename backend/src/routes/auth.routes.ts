import { Router } from "express";
import { login, me, register } from "../controllers/auth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
// Express Router — способ вынести маршруты из `app.js`
//  в отдельные файлы и группировать их по сущностям.
const router = Router();

// При POST-запросе на `/register` Express передаёт обработку
// функции `register`, где находится логика регистрации пользователя.

// /api/auth/... (в app.ts подвязал)
router.post("/register", register);
router.post("/login", login);
router.get("/me", authMiddleware, me);

export default router;
