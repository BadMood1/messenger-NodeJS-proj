import express from "express";
import { prisma } from "./lib/prisma.js";

const app = express();

app.use(express.json());

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
