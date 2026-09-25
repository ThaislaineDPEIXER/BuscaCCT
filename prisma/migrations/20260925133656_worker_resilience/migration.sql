-- AlterTable
ALTER TABLE "Sindicato" ADD COLUMN     "falhasConsecutivas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proximaTentativa" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkerLock" (
    "chave" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "adquiridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLock_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "WorkerLock_expiresAt_idx" ON "WorkerLock"("expiresAt");
