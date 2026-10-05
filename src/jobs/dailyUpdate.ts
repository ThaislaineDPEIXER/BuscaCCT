import crypto from 'node:crypto';
import cron from 'node-cron';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db';
import { extrairCctComIa } from '../services/claudeAgent';
import { persistirExtracaoCct } from '../services/cctExtractionPersistence';
import { enviarDigest, gerarAlertasDataBase } from '../services/alertService';
import { notificarFalhaMte } from '../services/operationalAlert';
import { buscarCctNoSite, varrerSindicato } from '../services/radarDiscovery';
import { adquirirWorkerLock } from '../services/workerLock';
import { resolveStoredDocumentPath } from '../services/documentStorage';
import { storePdf } from '../services/documentStorage';
import { STATUS_ENQUADRAMENTO, rotuloStatusEnquadramento } from '../services/enquadramentoStatus';
import { appendRowToSheet, baixarArquivoDrive, ensureCctDashboard, ensureDriveFolder, listarDocumentosPendentes, marcarDocumento, moverArquivoDriveParaPasta, syncEnquadramentoMatrix, uploadPdfToDrive, uploadTextToDrive } from '../services/googleWorkspace';
import { extrairTextoPdf } from '../services/cctOcr';
import { identificarPdfCctManual, textoContemCnpj } from '../services/documentImport';
import { buscarESalvarCCTComAno, CctAccessBlockedError, CctCaptchaRequiredError, CctManualDownloadRequiredError, CctNoResultsError, type ResultadoBuscaCct } from '../tools/mteScraper';
import { importarDocumentosDoDrive } from './importDocuments';
import { syncAdminSheets } from './syncAdminSheets';

const pausar = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const delayAleatorio = (): number => {
  const minimo = Math.min(env.mteDelayMinMs, env.mteDelayMaxMs);
  const maximo = Math.max(env.mteDelayMinMs, env.mteDelayMaxMs);
  return Math.floor(Math.random() * (maximo - minimo + 1) + minimo);
};

export function calcularProximaTentativa(falhasConsecutivas: number, agora = new Date()): Date {
  const expoente = Math.max(0, falhasConsecutivas - 1);
  const atraso = Math.min(env.mteRetryBaseDelayMs * (2 ** expoente), env.mteRetryMaxDelayMs);
  return new Date(agora.getTime() + atraso);
}

export function cctsQueBloqueiamFila(cacheCctDesde: Date, reprocessarPendenciasManuais: boolean): Prisma.ConvencaoColetivaWhereInput[] {
  return [
    ...(!reprocessarPendenciasManuais ? [{ status: 'PENDENTE_DOWNLOAD_MANUAL' }] : []),
    { status: 'EXTRAIDA', dataAtualizacao: { gte: cacheCctDesde } },
    { status: 'EXTRAIDA', fonteTipo: 'UPLOAD_MANUAL' }
  ];
}

export function filtroElegibilidadeFilaMte(
  agora: Date,
  limite: Date,
  anoAtual: number,
  mesAtual: number,
  reprocessarPendenciasManuais: boolean
): Prisma.SindicatoWhereInput {
  const elegibilidadeNormal: Prisma.SindicatoWhereInput = {
    AND: [
      { OR: [{ proximaTentativa: null }, { proximaTentativa: { lte: agora } }] },
      { OR: [
        { ultimaVarredura: null },
        { ultimaVarredura: { lt: limite } },
        { mesDataBase: mesAtual }
      ] }
    ]
  };

  return reprocessarPendenciasManuais
    ? {
      OR: [
        elegibilidadeNormal,
        { convencoes: { some: { anoVigencia: anoAtual, status: 'PENDENTE_DOWNLOAD_MANUAL' } } }
      ]
    }
    : elegibilidadeNormal;
}

let varreduraEmAndamento = false;

export function descreverImpacto(totalImpactos: number, resumo: string | null): string {
  const alerta = totalImpactos > 0
    ? `Alerta: ${totalImpactos} impacto(s) na folha`
    : 'Sem alteração';
  return resumo ? `${alerta} — ${resumo}` : alerta;
}

export function deveAcionarFallbackAutomaticoMte(error: unknown): boolean {
  return error instanceof CctAccessBlockedError
    || error instanceof CctCaptchaRequiredError
    || error instanceof CctManualDownloadRequiredError
    || error instanceof CctNoResultsError;
}

async function buscarCctPorFallbackAutomatico(sindicatoId: string, cnpjSindicato: string, anoVigencia: number, causa: unknown): Promise<ResultadoBuscaCct> {
  console.warn(`[MTE] Acionando fallback automático por site para ${cnpjSindicato}/${anoVigencia}:`, causa);
  const resultado = await buscarCctNoSite(sindicatoId);
  const cct = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato, anoVigencia: resultado.anoVigencia } },
    select: { textoCompleto: true }
  });
  const texto = cct?.textoCompleto?.trim();
  if (!texto) {
    throw new Error(`Fallback por site não persistiu texto utilizável para ${cnpjSindicato}/${resultado.anoVigencia}.`);
  }
  return { texto, anoVigencia: resultado.anoVigencia, fonteUrl: resultado.fonteUrl };
}

async function sincronizarMatrizEnquadramento(): Promise<void> {
  if (env.documentStorageDriver !== 'workspace') return;

  const enquadramentos = await prisma.enquadramentoSindical.findMany({
    orderBy: [{ status: 'asc' }, { atualizadoEm: 'desc' }],
    select: {
      tipo: true,
      grau: true,
      status: true,
      validadoPor: true,
      validadoEm: true,
      observacoes: true,
      cliente: { select: { cnpj: true, razaoSocial: true, cnaePrincipal: true } },
      sindicato: { select: { cnpj: true, razaoSocial: true } }
    }
  });

  await syncEnquadramentoMatrix(env.googleSheetId, enquadramentos.map(item => [
    item.cliente.cnpj,
    item.cliente.razaoSocial,
    item.cliente.cnaePrincipal,
    `${item.sindicato.razaoSocial} (${item.sindicato.cnpj})`,
    item.tipo,
    item.grau,
    rotuloStatusEnquadramento(item.status),
    item.validadoPor ?? '',
    item.validadoEm?.toISOString() ?? '',
    item.observacoes ?? ''
  ]));
}

type SindicatoPainel = { cnpj: string; razaoSocial: string; codigoSindical: string | null };
type EmpresaPainel = { razaoSocial: string; codigoErp: string | null; cctRegistro: string | null };
const TAMANHO_MAXIMO_CCT_MANUAL = 30 * 1024 * 1024;

const formatarCnpj = (cnpj: string) =>
  /^\d{14}$/.test(cnpj) ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj;

export function montarLinhaPainel(
  data: Date,
  sindicato: SindicatoPainel,
  empresas: EmpresaPainel[],
  resumo: string,
  linkDrive: string
): string[] {
  const registros = [...new Set(empresas.map(empresa => empresa.cctRegistro?.trim()).filter(Boolean))];
  return [
    data.toISOString(),
    sindicato.codigoSindical?.trim() || '-',
    '-',
    sindicato.razaoSocial,
    formatarCnpj(sindicato.cnpj),
    empresas.map(empresa => `${empresa.razaoSocial} (Cód: ${empresa.codigoErp?.trim() || '-'})`).join('; '),
    registros.join('; ') || '-',
    resumo,
    linkDrive
  ];
}

async function publicarCctNoWorkspace(sindicato: SindicatoPainel, anoVigencia: number, atualizarPainel = true): Promise<void> {
  if (env.documentStorageDriver !== 'workspace') return;
  const cnpjSindicato = sindicato.cnpj;

  const cct = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato, anoVigencia } },
    select: { id: true, documentoStoragePath: true, fonteUrl: true, parametrosJson: true, resumoCct: true, _count: { select: { impactosFolha: true } } }
  });
  if (!cct) return;

  const pastaAno = await ensureDriveFolder(env.googleDriveFolderId, String(anoVigencia));
  const nomePastaSindicato = `${cnpjSindicato} - ${sindicato.razaoSocial.trim()}`.replace(/[\\/]/g, '-');
  const pastaSindicato = await ensureDriveFolder(pastaAno, nomePastaSindicato);
  let linkPdf = '';
  if (cct.documentoStoragePath) {
    const filePath = resolveStoredDocumentPath(env.documentStoragePath, cct.documentoStoragePath);
    if (filePath) {
      linkPdf = await uploadPdfToDrive(cct.documentoStoragePath.split('/').pop() ?? `CCT-${anoVigencia}-${cnpjSindicato}.pdf`, filePath, pastaSindicato);
    } else if (cct.documentoStoragePath.includes('drive.google.com')) {
      linkPdf = await moverArquivoDriveParaPasta(cct.documentoStoragePath, pastaSindicato);
    } else {
      linkPdf = cct.documentoStoragePath;
    }

    if (linkPdf && linkPdf !== cct.documentoStoragePath) {
      await prisma.$transaction([
        prisma.convencaoColetiva.update({ where: { id: cct.id }, data: { documentoStoragePath: linkPdf } }),
        prisma.evidenciaCct.updateMany({
          where: { convencaoColetivaId: cct.id, storagePath: cct.documentoStoragePath },
          data: { storagePath: linkPdf, url: linkPdf, referencia: 'PDF da CCT arquivado na pasta do sindicato e ano no Google Drive.' }
        })
      ]);
    }
  }

  let parametros: Record<string, unknown> = {};
  try {
    if (cct.parametrosJson) parametros = JSON.parse(cct.parametrosJson) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[WORKSPACE] Parametros da CCT ${cnpjSindicato}/${anoVigencia} invalidos para resumo:`, error);
  }
  const resumoParametrizado = typeof parametros.resumo_mudancas === 'string' ? parametros.resumo_mudancas.trim() : '';
  const resumo = cct.resumoCct?.trim() || resumoParametrizado || 'Resumo nao disponivel.';
  const conteudoResumo = [
    `Sindicato laboral: ${sindicato.razaoSocial}`,
    `CNPJ: ${formatarCnpj(cnpjSindicato)}`,
    `Ano de vigencia: ${anoVigencia}`,
    `Fonte: ${cct.fonteUrl ?? 'Sistema Mediador do MTE'}`,
    `PDF: ${linkPdf || 'Nao disponivel'}`,
    '',
    'Resumo da CCT:',
    resumo,
    '',
    'Parametros extraidos (JSON):',
    JSON.stringify(parametros, null, 2)
  ].join('\n');
  await uploadTextToDrive(`Resumo-CCT-${anoVigencia}-${cnpjSindicato}.txt`, conteudoResumo, pastaSindicato);
  if (!atualizarPainel) return;
  const linkPasta = `https://drive.google.com/drive/folders/${pastaSindicato}`;
  try {
    await ensureCctDashboard(env.googleSheetId);
  } catch (error) {
    console.warn('[WORKSPACE] CCT publicada, mas o painel do Sheets não pôde ser preparado:', error);
    return;
  }
  const empresasVinculadas = await prisma.enquadramentoSindical.findMany({
    where: { sindicato: { cnpj: cnpjSindicato }, status: STATUS_ENQUADRAMENTO.CONFIRMADO },
    select: { cliente: { select: { razaoSocial: true, codigoErp: true, cctRegistro: true } } },
    orderBy: { cliente: { razaoSocial: 'asc' } }
  });
  await appendRowToSheet(env.googleSheetId, montarLinhaPainel(
    new Date(),
    sindicato,
    empresasVinculadas.map(({ cliente }) => cliente),
    descreverImpacto(cct._count.impactosFolha, cct.resumoCct),
    linkPasta
  ));
}

async function processarCctsManuaisDoDrive(): Promise<void> {
  if (env.documentStorageDriver !== 'workspace' || !env.googleDriveInboxFolderId) return;
  const pendentes = await listarDocumentosPendentes(
    env.googleDriveInboxFolderId,
    process.env.RETRY_FAILED_UNION_IMPORTS === 'true'
  );
  const pdfs = pendentes.filter(documento => documento.mimeType === 'application/pdf' && identificarPdfCctManual(documento.nome));
  if (pdfs.length === 0) {
    console.info('[CCT-MANUAL] Nenhum PDF manual de CCT pendente.');
    return;
  }

  for (const documento of pdfs) {
    const alvo = identificarPdfCctManual(documento.nome);
    if (!alvo) continue;
    try {
      if (documento.tamanho > TAMANHO_MAXIMO_CCT_MANUAL) {
        throw new Error(`PDF acima de ${TAMANHO_MAXIMO_CCT_MANUAL / 1024 / 1024} MB.`);
      }
      const sindicato = await prisma.sindicato.findUnique({
        where: { cnpj: alvo.cnpjSindicato },
        select: { id: true, cnpj: true, razaoSocial: true, codigoSindical: true, ativo: true }
      });
      if (!sindicato) throw new Error(`Sindicato ${alvo.cnpjSindicato} não está cadastrado.`);
      const cctExistente = await prisma.convencaoColetiva.findUnique({
        where: { cnpjSindicato_anoVigencia: { cnpjSindicato: alvo.cnpjSindicato, anoVigencia: alvo.anoVigencia } },
        select: { id: true, status: true }
      });
      if (cctExistente?.status !== 'PENDENTE_DOWNLOAD_MANUAL') {
        throw new Error(`Não há pendência manual para ${alvo.cnpjSindicato}/${alvo.anoVigencia}.`);
      }

      const pdf = await baixarArquivoDrive(documento.id);
      if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('O arquivo não tem assinatura PDF válida.');
      const texto = await extrairTextoPdf(pdf);
      if (!textoContemCnpj(texto, alvo.cnpjSindicato)) {
        throw new Error(`O texto extraído não contém o CNPJ ${alvo.cnpjSindicato}; associação manual recusada.`);
      }
      const extracao = await extrairCctComIa(texto);
      const armazenado = await storePdf(
        pdf,
        env.documentStoragePath,
        `manual-${alvo.cnpjSindicato}-${alvo.anoVigencia}-${documento.id}.pdf`
      );
      const linkOrigem = `https://drive.google.com/file/d/${documento.id}/view`;
      const cct = await prisma.convencaoColetiva.upsert({
        where: { cnpjSindicato_anoVigencia: { cnpjSindicato: alvo.cnpjSindicato, anoVigencia: alvo.anoVigencia } },
        update: {
          textoCompleto: texto,
          fonteTipo: 'UPLOAD_MANUAL',
          fonteUrl: linkOrigem,
          documentoStoragePath: armazenado.storagePath,
          hashDocumento: armazenado.hashSha256,
          status: 'CAPTURADA'
        },
        create: {
          cnpjSindicato: alvo.cnpjSindicato,
          anoVigencia: alvo.anoVigencia,
          textoCompleto: texto,
          fonteTipo: 'UPLOAD_MANUAL',
          fonteUrl: linkOrigem,
          documentoStoragePath: armazenado.storagePath,
          hashDocumento: armazenado.hashSha256,
          status: 'CAPTURADA'
        }
      });
      const evidencia = await prisma.evidenciaCct.findFirst({
        where: { convencaoColetivaId: cct.id, hashSha256: armazenado.hashSha256 },
        select: { id: true }
      });
      if (!evidencia) {
        await prisma.evidenciaCct.create({
          data: {
            convencaoColetivaId: cct.id,
            tipo: 'DOCUMENTO_MANUAL',
            url: linkOrigem,
            storagePath: armazenado.storagePath,
            hashSha256: armazenado.hashSha256,
            referencia: 'PDF da CCT enviado manualmente para contornar indisponibilidade do Mediador.'
          }
        });
      }

      await persistirExtracaoCct(alvo.cnpjSindicato, alvo.anoVigencia, extracao);
      await prisma.sindicato.update({
        where: { id: sindicato.id },
        data: { ultimaVarredura: new Date(), proximaTentativa: null, falhasConsecutivas: 0 }
      });
      await publicarCctNoWorkspace(sindicato, alvo.anoVigencia);
      await marcarDocumento(documento.id, 'importado', `${alvo.cnpjSindicato}/${alvo.anoVigencia}: CCT manual extraída`);
      console.info(`[CCT-MANUAL] ${documento.nome}: extração concluída para ${sindicato.cnpj}/${alvo.anoVigencia}.`);
    } catch (error) {
      const detalhe = error instanceof Error ? error.message : String(error);
      console.error(`[CCT-MANUAL] Falha ao processar "${documento.nome}":`, detalhe);
      await marcarDocumento(documento.id, 'erro', detalhe).catch(markError => {
        console.error(`[CCT-MANUAL] Não foi possível marcar "${documento.nome}" com erro:`, markError);
      });
    }
  }
}

async function selecionarFila() {
  const agora = new Date();
  const limite = new Date(agora.getTime() - env.mteStaleAfterHours * 60 * 60 * 1_000);
  const cacheCctDesde = new Date(agora.getTime() - 24 * 60 * 60 * 1_000);
  const mesAtual = agora.getMonth() + 1;
  const anoAtual = agora.getFullYear();
  const reprocessarPendenciasManuais = process.env.RETRY_FAILED_UNION_IMPORTS === 'true';

  return prisma.sindicato.findMany({
    where: {
      ativo: true,
      enquadramentos: { some: { status: STATUS_ENQUADRAMENTO.CONFIRMADO } },
      convencoes: {
        none: {
          anoVigencia: anoAtual,
          OR: cctsQueBloqueiamFila(cacheCctDesde, process.env.RETRY_FAILED_UNION_IMPORTS === 'true')
        }
      },
      AND: [filtroElegibilidadeFilaMte(agora, limite, anoAtual, mesAtual, reprocessarPendenciasManuais)]
    },
    orderBy: [{ ultimaVarredura: 'asc' }, { atualizadoEm: 'asc' }],
    take: env.mteBatchSize,
    select: { id: true, cnpj: true, razaoSocial: true, codigoSindical: true, mesDataBase: true, falhasConsecutivas: true }
  });
}

export async function executarFilaMte(): Promise<void> {
  if (varreduraEmAndamento) {
    console.warn('[MTE] Fila anterior ainda está em execução; nova execução ignorada.');
    return;
  }

  varreduraEmAndamento = true;
  try {
    try {
      await importarDocumentosDoDrive();
    } catch (error) {
      console.error('[DOCS] Documentos da pasta de entrada não importados; os cadastros atuais seguem valendo:', error);
    }

    try {
      await syncAdminSheets();
    } catch (error) {
      console.error('[SYNC] Cadastros da planilha não sincronizados; a fila usará os dados já existentes no banco:', error);
    }

    try {
      await sincronizarMatrizEnquadramento();
    } catch (error) {
      console.warn('[WORKSPACE] Matriz de enquadramento não sincronizada; a fila segue normalmente:', error);
    }

    try {
      await processarCctsManuaisDoDrive();
    } catch (error) {
      console.error('[CCT-MANUAL] Falha ao processar PDFs manuais; o worker seguirá com a fila:', error);
    }

    const sindicatos = await selecionarFila();
    console.info(`[MTE] ${sindicatos.length} sindicatos selecionados para a fila.`);

    for (const sindicato of sindicatos) {
      const ownerId = crypto.randomUUID();
      const liberarLock = await adquirirWorkerLock(`mte:${sindicato.cnpj}`, ownerId, env.workerLockTtlMs);
      if (!liberarLock) {
        console.info(`[MTE] CNPJ ${sindicato.cnpj} já está sendo processado por outro worker.`);
        continue;
      }

      try {
        console.info(`[MTE] Processando ${sindicato.cnpj} (${sindicato.razaoSocial})`);
        const anoVigencia = new Date().getFullYear();
        let resultadoCct: ResultadoBuscaCct;
        try {
          resultadoCct = await buscarESalvarCCTComAno(sindicato.cnpj, anoVigencia);
        } catch (error) {
          if (!deveAcionarFallbackAutomaticoMte(error)) throw error;
          resultadoCct = await buscarCctPorFallbackAutomatico(sindicato.id, sindicato.cnpj, anoVigencia, error);
        }
        await publicarCctNoWorkspace(sindicato, resultadoCct.anoVigencia, false);
        const parametros = await extrairCctComIa(resultadoCct.texto);

        await persistirExtracaoCct(sindicato.cnpj, resultadoCct.anoVigencia, parametros);
        await publicarCctNoWorkspace(sindicato, resultadoCct.anoVigencia);
        await prisma.sindicato.update({
          where: { id: sindicato.id },
          data: { ultimaVarredura: new Date(), proximaTentativa: null, falhasConsecutivas: 0 }
        });
        console.info(`[MTE] CCT ${resultadoCct.anoVigencia} processada e extraída para ${sindicato.cnpj}`);
      } catch (error) {
        console.error(`[MTE] Falha no CNPJ ${sindicato.cnpj}:`, error);
        await notificarFalhaMte(sindicato.cnpj, error);
        const falhasConsecutivas = sindicato.falhasConsecutivas + 1;
        await prisma.sindicato.update({
          where: { id: sindicato.id },
          data: {
            falhasConsecutivas,
            proximaTentativa: calcularProximaTentativa(falhasConsecutivas)
          }
        });
      } finally {
        await liberarLock();
        const espera = delayAleatorio();
        console.info(`[MTE] Pausa de ${Math.round(espera / 1_000)}s antes do próximo sindicato.`);
        await pausar(espera);
      }
    }
  } finally {
    varreduraEmAndamento = false;
  }
}

export function startCronJobs(): ReturnType<typeof cron.schedule>[] {
  const tarefas = [
    cron.schedule('0 2 * * *', () => void executarFilaMte(), { timezone: env.cronTimezone }),

    cron.schedule('30 3 * * 1', async () => {
    if (varreduraEmAndamento) {
      console.warn('[RADAR] Fila MTE ainda está em execução; varredura semanal adiada.');
      return;
    }
    console.info('[RADAR] Iniciando varredura semanal de sites');
    const sindicatos = await prisma.sindicato.findMany({
      where: { ativo: true, enquadramentos: { some: { status: STATUS_ENQUADRAMENTO.CONFIRMADO } } },
      select: { id: true }
    });
    for (const sindicato of sindicatos) {
      try { await varrerSindicato(sindicato.id); } catch (error) { console.error(`[RADAR] Falha no sindicato ${sindicato.id}:`, error); }
      await pausar(delayAleatorio());
    }
    }, { timezone: env.cronTimezone }),

    cron.schedule('0 1 1 * *', () => void gerarAlertasDataBase(), { timezone: env.cronTimezone }),
    cron.schedule('30 7 * * *', () => void enviarDigest(), { timezone: env.cronTimezone })
  ];

  return tarefas;
}
