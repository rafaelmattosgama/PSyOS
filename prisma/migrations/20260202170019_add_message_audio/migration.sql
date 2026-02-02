-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attachmentAuthTag" TEXT,
ADD COLUMN     "attachmentCiphertext" TEXT,
ADD COLUMN     "attachmentIv" TEXT,
ADD COLUMN     "attachmentMime" TEXT,
ADD COLUMN     "attachmentSize" INTEGER;
