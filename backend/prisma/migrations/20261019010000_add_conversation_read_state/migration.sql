-- У существующих участников граница пока неизвестна: оба поля остаются NULL.
-- Без foreign key на Message: удаление сообщения не должно сбрасывать прочтение.
ALTER TABLE "ConversationMember"
ADD COLUMN "lastReadMessageId" TEXT,
ADD COLUMN "lastReadMessageCreatedAt" TIMESTAMP(3);
