-- CreateEnum
CREATE TYPE "Language" AS ENUM ('PT', 'ES', 'EN');

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'PT';
