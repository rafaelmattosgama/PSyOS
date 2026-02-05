-- CreateTable
CREATE TABLE "WeeklySummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklySummary_tenantId_idx" ON "WeeklySummary"("tenantId");

-- CreateIndex
CREATE INDEX "WeeklySummary_conversationId_idx" ON "WeeklySummary"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklySummary_conversationId_weekStart_key" ON "WeeklySummary"("conversationId", "weekStart");

-- AddForeignKey
ALTER TABLE "WeeklySummary" ADD CONSTRAINT "WeeklySummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklySummary" ADD CONSTRAINT "WeeklySummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
