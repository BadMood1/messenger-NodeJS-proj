-- Поле необязательное: существующие сообщения остаются с NULL.
ALTER TABLE "Message" ADD COLUMN "clientMessageId" TEXT;

-- PostgreSQL допускает несколько NULL; уникальность применяется к заполненным client id.
CREATE UNIQUE INDEX "Message_senderId_clientMessageId_key"
ON "Message"("senderId", "clientMessageId");
