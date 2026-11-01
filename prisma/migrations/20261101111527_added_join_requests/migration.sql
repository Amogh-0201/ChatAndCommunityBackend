-- CreateEnum
CREATE TYPE "GroupJoinPolicy" AS ENUM ('OPEN', 'REQUEST', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "joinPolicy" "GroupJoinPolicy" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "ConversationJoinRequest" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "ConversationJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationJoinRequest_conversationId_status_createdAt_idx" ON "ConversationJoinRequest"("conversationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ConversationJoinRequest_requesterId_status_createdAt_idx" ON "ConversationJoinRequest"("requesterId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationJoinRequest_conversationId_requesterId_key" ON "ConversationJoinRequest"("conversationId", "requesterId");

-- AddForeignKey
ALTER TABLE "ConversationJoinRequest" ADD CONSTRAINT "ConversationJoinRequest_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJoinRequest" ADD CONSTRAINT "ConversationJoinRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationJoinRequest" ADD CONSTRAINT "ConversationJoinRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
