/*
  Warnings:

  - A unique constraint covering the columns `[tipo,hashArquivo]` on the table `ImportacaoLote` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ImportacaoLote" ADD COLUMN     "hashArquivo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ImportacaoLote_tipo_hashArquivo_key" ON "ImportacaoLote"("tipo", "hashArquivo");
