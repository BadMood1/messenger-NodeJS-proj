-- У существующих пользователей время неизвестно, поэтому оставляем NULL.
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
