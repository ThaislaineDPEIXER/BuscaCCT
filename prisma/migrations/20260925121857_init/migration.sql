-- CreateTable
CREATE TABLE "ConvencaoColetiva" (
    "id" TEXT NOT NULL,
    "cnpjSindicato" TEXT NOT NULL,
    "anoVigencia" INTEGER NOT NULL,
    "textoCompleto" TEXT NOT NULL,
    "parametrosJson" TEXT,
    "fonteTipo" TEXT NOT NULL DEFAULT 'MTE',
    "fonteUrl" TEXT,
    "documentoStoragePath" TEXT,
    "hashDocumento" TEXT,
    "resumoCct" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CAPTURADA',
    "dataConsulta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConvencaoColetiva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sindicato" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "cnpjBase" TEXT,
    "razaoSocial" TEXT NOT NULL DEFAULT '',
    "nomeFantasia" TEXT,
    "uf" TEXT NOT NULL DEFAULT '',
    "cidade" TEXT NOT NULL DEFAULT '',
    "cnae" TEXT NOT NULL DEFAULT '',
    "segmento" TEXT,
    "mesDataBase" INTEGER,
    "siteUrl" TEXT,
    "siteOficial" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "statusMonitoramento" TEXT NOT NULL DEFAULT 'ATIVO',
    "ultimaVarredura" TIMESTAMP(3),
    "ultimaVarreduraSite" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sindicato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadarScan" (
    "id" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "urlConsultada" TEXT NOT NULL,
    "novaCct" BOOLEAN NOT NULL,
    "resumo" TEXT,
    "evidencias" TEXT,
    "textoHash" TEXT,
    "consultadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadarScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "codigoErp" TEXT,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnaePrincipal" TEXT NOT NULL,
    "descricaoCnae" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportacaoLote" (
    "id" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'CLIENTES',
    "status" TEXT NOT NULL DEFAULT 'PROCESSANDO',
    "totalLinhas" INTEGER NOT NULL DEFAULT 0,
    "processadas" INTEGER NOT NULL DEFAULT 0,
    "invalidas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "ImportacaoLote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportacaoLinha" (
    "id" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "numeroLinha" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "mensagem" TEXT,
    "dadosJson" TEXT NOT NULL,
    "clienteId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportacaoLinha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClausulaCct" (
    "id" TEXT NOT NULL,
    "convencaoColetivaId" TEXT NOT NULL,
    "referencia" TEXT,
    "titulo" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "textoEvidencia" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClausulaCct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactoFolha" (
    "id" TEXT NOT NULL,
    "convencaoColetivaId" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "valorAnterior" DOUBLE PRECISION,
    "valorNovo" DOUBLE PRECISION,
    "percentual" DOUBLE PRECISION,
    "vigencia" TEXT,
    "evidencia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE_VALIDACAO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactoFolha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContribuicaoSindical" (
    "id" TEXT NOT NULL,
    "convencaoColetivaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valorTexto" TEXT,
    "valorNumerico" DOUBLE PRECISION,
    "percentual" DOUBLE PRECISION,
    "vencimento" TEXT,
    "obrigatoriedade" TEXT,
    "dadosPagamento" TEXT,
    "evidencia" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOVA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContribuicaoSindical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenciaCct" (
    "id" TEXT NOT NULL,
    "convencaoColetivaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT,
    "storagePath" TEXT,
    "hashSha256" TEXT,
    "referencia" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaCct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportacaoSindicato" (
    "id" TEXT NOT NULL,
    "convencaoColetivaId" TEXT,
    "sindicatoCnpj" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SOLICITADA',
    "storagePath" TEXT,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),

    CONSTRAINT "ExportacaoSindicato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquadramentoSindical" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "sindicatoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGERIDO_IA',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnquadramentoSindical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertaDP" (
    "id" TEXT NOT NULL,
    "sindicatoCnpj" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridade" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "clientesImpactados" INTEGER NOT NULL DEFAULT 0,
    "chaveUnica" TEXT,
    "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataAtualizacao" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertaDP_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConvencaoColetiva_dataAtualizacao_idx" ON "ConvencaoColetiva"("dataAtualizacao");

-- CreateIndex
CREATE INDEX "ConvencaoColetiva_status_anoVigencia_idx" ON "ConvencaoColetiva"("status", "anoVigencia");

-- CreateIndex
CREATE UNIQUE INDEX "ConvencaoColetiva_cnpjSindicato_anoVigencia_key" ON "ConvencaoColetiva"("cnpjSindicato", "anoVigencia");

-- CreateIndex
CREATE UNIQUE INDEX "Sindicato_cnpj_key" ON "Sindicato"("cnpj");

-- CreateIndex
CREATE INDEX "RadarScan_sindicatoId_consultadoEm_idx" ON "RadarScan"("sindicatoId", "consultadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cnpj_key" ON "Cliente"("cnpj");

-- CreateIndex
CREATE INDEX "Cliente_uf_cidade_idx" ON "Cliente"("uf", "cidade");

-- CreateIndex
CREATE INDEX "Cliente_cnaePrincipal_idx" ON "Cliente"("cnaePrincipal");

-- CreateIndex
CREATE INDEX "Cliente_codigoErp_idx" ON "Cliente"("codigoErp");

-- CreateIndex
CREATE INDEX "ImportacaoLinha_status_idx" ON "ImportacaoLinha"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportacaoLinha_loteId_numeroLinha_key" ON "ImportacaoLinha"("loteId", "numeroLinha");

-- CreateIndex
CREATE INDEX "ClausulaCct_convencaoColetivaId_idx" ON "ClausulaCct"("convencaoColetivaId");

-- CreateIndex
CREATE INDEX "ImpactoFolha_convencaoColetivaId_status_idx" ON "ImpactoFolha"("convencaoColetivaId", "status");

-- CreateIndex
CREATE INDEX "ContribuicaoSindical_status_vencimento_idx" ON "ContribuicaoSindical"("status", "vencimento");

-- CreateIndex
CREATE INDEX "ContribuicaoSindical_convencaoColetivaId_idx" ON "ContribuicaoSindical"("convencaoColetivaId");

-- CreateIndex
CREATE INDEX "EvidenciaCct_convencaoColetivaId_idx" ON "EvidenciaCct"("convencaoColetivaId");

-- CreateIndex
CREATE INDEX "ExportacaoSindicato_sindicatoCnpj_status_idx" ON "ExportacaoSindicato"("sindicatoCnpj", "status");

-- CreateIndex
CREATE INDEX "EnquadramentoSindical_status_idx" ON "EnquadramentoSindical"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EnquadramentoSindical_clienteId_sindicatoId_key" ON "EnquadramentoSindical"("clienteId", "sindicatoId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertaDP_chaveUnica_key" ON "AlertaDP"("chaveUnica");

-- CreateIndex
CREATE INDEX "AlertaDP_status_prioridade_idx" ON "AlertaDP"("status", "prioridade");

-- CreateIndex
CREATE INDEX "AlertaDP_sindicatoCnpj_dataCriacao_idx" ON "AlertaDP"("sindicatoCnpj", "dataCriacao");

-- AddForeignKey
ALTER TABLE "ConvencaoColetiva" ADD CONSTRAINT "ConvencaoColetiva_cnpjSindicato_fkey" FOREIGN KEY ("cnpjSindicato") REFERENCES "Sindicato"("cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadarScan" ADD CONSTRAINT "RadarScan_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "Sindicato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportacaoLinha" ADD CONSTRAINT "ImportacaoLinha_loteId_fkey" FOREIGN KEY ("loteId") REFERENCES "ImportacaoLote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportacaoLinha" ADD CONSTRAINT "ImportacaoLinha_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClausulaCct" ADD CONSTRAINT "ClausulaCct_convencaoColetivaId_fkey" FOREIGN KEY ("convencaoColetivaId") REFERENCES "ConvencaoColetiva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactoFolha" ADD CONSTRAINT "ImpactoFolha_convencaoColetivaId_fkey" FOREIGN KEY ("convencaoColetivaId") REFERENCES "ConvencaoColetiva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContribuicaoSindical" ADD CONSTRAINT "ContribuicaoSindical_convencaoColetivaId_fkey" FOREIGN KEY ("convencaoColetivaId") REFERENCES "ConvencaoColetiva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaCct" ADD CONSTRAINT "EvidenciaCct_convencaoColetivaId_fkey" FOREIGN KEY ("convencaoColetivaId") REFERENCES "ConvencaoColetiva"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportacaoSindicato" ADD CONSTRAINT "ExportacaoSindicato_convencaoColetivaId_fkey" FOREIGN KEY ("convencaoColetivaId") REFERENCES "ConvencaoColetiva"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportacaoSindicato" ADD CONSTRAINT "ExportacaoSindicato_sindicatoCnpj_fkey" FOREIGN KEY ("sindicatoCnpj") REFERENCES "Sindicato"("cnpj") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquadramentoSindical" ADD CONSTRAINT "EnquadramentoSindical_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquadramentoSindical" ADD CONSTRAINT "EnquadramentoSindical_sindicatoId_fkey" FOREIGN KEY ("sindicatoId") REFERENCES "Sindicato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaDP" ADD CONSTRAINT "AlertaDP_sindicatoCnpj_fkey" FOREIGN KEY ("sindicatoCnpj") REFERENCES "Sindicato"("cnpj") ON DELETE CASCADE ON UPDATE CASCADE;
