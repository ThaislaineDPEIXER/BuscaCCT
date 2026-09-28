-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "cnaesSecundarios" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "porte" TEXT,
ADD COLUMN     "quantidadeFuncionarios" INTEGER,
ADD COLUMN     "sindicatoFolha" TEXT;

-- AlterTable
ALTER TABLE "EnquadramentoSindical" ADD COLUMN     "grau" TEXT NOT NULL DEFAULT 'DIRETO',
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "validadoEm" TIMESTAMP(3),
ADD COLUMN     "validadoPor" TEXT;

-- AlterTable
ALTER TABLE "Sindicato" ADD COLUMN     "baseTerritorial" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "codigoSindical" TEXT;
