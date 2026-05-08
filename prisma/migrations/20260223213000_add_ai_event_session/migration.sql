-- CreateEnum
CREATE TYPE "AiEventStatus" AS ENUM ('OPEN', 'CLOSED', 'ABORTED');

-- CreateTable
CREATE TABLE "AiEventSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "flowSessionId" TEXT,
    "status" "AiEventStatus" NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "summaryJson" JSONB,
    "adherenceJson" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiEventSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiEventSession_flowSessionId_key" ON "AiEventSession"("flowSessionId");

-- CreateIndex
CREATE INDEX "AiEventSession_tenantId_idx" ON "AiEventSession"("tenantId");

-- CreateIndex
CREATE INDEX "AiEventSession_conversationId_status_idx" ON "AiEventSession"("conversationId", "status");

-- CreateIndex
CREATE INDEX "AiEventSession_patientUserId_idx" ON "AiEventSession"("patientUserId");

-- CreateIndex
CREATE INDEX "AiEventSession_updatedAt_idx" ON "AiEventSession"("updatedAt");

-- AddForeignKey
ALTER TABLE "AiEventSession" ADD CONSTRAINT "AiEventSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEventSession" ADD CONSTRAINT "AiEventSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEventSession" ADD CONSTRAINT "AiEventSession_patientUserId_fkey" FOREIGN KEY ("patientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEventSession" ADD CONSTRAINT "AiEventSession_flowSessionId_fkey" FOREIGN KEY ("flowSessionId") REFERENCES "AiFlowSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
