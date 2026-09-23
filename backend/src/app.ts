import express from "express";
import { prisma } from "./lib/prisma.js";
import authRouter from "./routes/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";
import cookieParser from "cookie-parser";
import { userRouter } from "./routes/user.routes.js";
import { friendRouter } from "./routes/friend.routes.js";

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRouter);
app.use("/api/users", userRouter);
app.use("/api/friends", friendRouter);

app.use(errorHandler);
//

app.get("/", (req, res) => {
    res.send("Hello, World!");
});

app.get("/api/users", async (req, res) => {
    const users = await prisma.user.findMany();

    res.json(users);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
