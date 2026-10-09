import express from "express";
import { createServer } from "node:http";
import { prisma } from "./lib/prisma.js";
import cors from "cors";
import authRouter from "./routes/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import cookieParser from "cookie-parser";
import { userRouter } from "./routes/user.routes.js";
import { friendRouter } from "./routes/friend.routes.js";
import { conversationRouter } from "./routes/conversation.routes.js";
import { initializeSocketServer } from "./lib/socket.js";

const app = express();
const FRONTEND_ORIGIN = "http://localhost:5173";

// Разрешаем нашему frontend отправлять запросы и cookies
app.use(
    cors({
        origin: FRONTEND_ORIGIN,
        credentials: true, // Разрешаем отправку cookies
    }),
);

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/friends", friendRouter);
app.use("/api/conversations", conversationRouter);

app.use(errorHandler);
//

const PORT = process.env.PORT || 5000;
// REST и Socket.IO используют один HTTP-сервер и один порт.
const httpServer = createServer(app);
initializeSocketServer(httpServer, FRONTEND_ORIGIN);

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
