-- CreateEnum
CREATE TYPE "AiFlowStatus" AS ENUM ('IDLE', 'ACTIVE', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "AiFlowStepState" AS ENUM ('PENDING', 'ANSWERED', 'EXPIRED', 'DISMISSED');

-- CreateTable
CREATE TABLE "AiFlowSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "patientUserId" TEXT NOT NULL,
    "status" "AiFlowStatus" NOT NULL DEFAULT 'IDLE',
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "maxSteps" INTEGER NOT NULL DEFAULT 3,
    "ignoredUiCount" INTEGER NOT NULL DEFAULT 0,
    "burdenScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastTarget" TEXT,
    "targetsJson" JSONB,
    "confidenceJson" JSONB,
    "cooldownUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFlowSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFlowStep" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "flowSessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "state" "AiFlowStepState" NOT NULL DEFAULT 'PENDING',
    "uiSpecJson" JSONB NOT NULL,
    "answerJson" JSONB,
    "expiresAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFlowStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiFlowSession_tenantId_idx" ON "AiFlowSession"("tenantId");

-- CreateIndex
CREATE INDEX "AiFlowSession_conversationId_status_idx" ON "AiFlowSession"("conversationId", "status");

-- CreateIndex
CREATE INDEX "AiFlowSession_patientUserId_idx" ON "AiFlowSession"("patientUserId");

-- CreateIndex
CREATE INDEX "AiFlowSession_updatedAt_idx" ON "AiFlowSession"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiFlowStep_messageId_key" ON "AiFlowStep"("messageId");

-- CreateIndex
CREATE INDEX "AiFlowStep_tenantId_idx" ON "AiFlowStep"("tenantId");

-- CreateIndex
CREATE INDEX "AiFlowStep_conversationId_state_idx" ON "AiFlowStep"("conversationId", "state");

-- CreateIndex
CREATE INDEX "AiFlowStep_flowSessionId_state_idx" ON "AiFlowStep"("flowSessionId", "state");

-- AddForeignKey
ALTER TABLE "AiFlowSession" ADD CONSTRAINT "AiFlowSession_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFlowSession" ADD CONSTRAINT "AiFlowSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFlowSession" ADD CONSTRAINT "AiFlowSession_patientUserId_fkey" FOREIGN KEY ("patientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFlowStep" ADD CONSTRAINT "AiFlowStep_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFlowStep" ADD CONSTRAINT "AiFlowStep_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFlowStep" ADD CONSTRAINT "AiFlowStep_flowSessionId_fkey" FOREIGN KEY ("flowSessionId") REFERENCES "AiFlowSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFlowStep" ADD CONSTRAINT "AiFlowStep_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
