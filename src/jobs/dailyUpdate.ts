import crypto from 'node:crypto';
import cron from 'node-cron';
import { env } from '../config/env';
import { prisma } from '../db';
import { extrairCctComIa } from '../services/claudeAgent';
import { persistirExtracaoCct } from '../services/cctExtractionPersistence';
import { enviarDigest, gerarAlertasDataBase } from '../services/alertService';
import { notificarFalhaMte } from '../services/operationalAlert';
import { varrerSindicato } from '../services/radarDiscovery';
import { adquirirWorkerLock } from '../services/workerLock';
import { resolveStoredDocumentPath } from '../services/documentStorage';
import { STATUS_ENQUADRAMENTO, rotuloStatusEnquadramento } from '../services/enquadramentoStatus';
import { appendRowToSheet, ensureCctDashboard, syncEnquadramentoMatrix, uploadPdfToDrive } from '../services/googleWorkspace';
import { buscarESalvarCCT } from '../tools/mteScraper';
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

let varreduraEmAndamento = false;

export function descreverImpacto(totalImpactos: number, resumo: string | null): string {
  const alerta = totalImpactos > 0
    ? `Alerta: ${totalImpactos} impacto(s) na folha`
    : 'Sem alteração';
  return resumo ? `${alerta} — ${resumo}` : alerta;
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

async function publicarCctNoWorkspace(cnpjSindicato: string, anoVigencia: number, sindicatoNome: string): Promise<void> {
  if (env.documentStorageDriver !== 'workspace') return;

  const cct = await prisma.convencaoColetiva.findUnique({
    where: { cnpjSindicato_anoVigencia: { cnpjSindicato, anoVigencia } },
    select: { id: true, documentoStoragePath: true, resumoCct: true, _count: { select: { impactosFolha: true } } }
  });
  if (!cct?.documentoStoragePath) return;

  const filePath = resolveStoredDocumentPath(env.documentStoragePath, cct.documentoStoragePath);
  if (!filePath) return;
  const linkPdf = await uploadPdfToDrive(cct.documentoStoragePath.split('/').pop() ?? 'cct.pdf', filePath, env.googleDriveFolderId);

  await prisma.$transaction([
    prisma.convencaoColetiva.update({ where: { id: cct.id }, data: { documentoStoragePath: linkPdf } }),
    prisma.evidenciaCct.updateMany({
      where: { convencaoColetivaId: cct.id, storagePath: cct.documentoStoragePath },
      data: { storagePath: linkPdf, url: linkPdf, referencia: 'PDF original arquivado no Google Drive.' }
    })
  ]);
  try {
    await ensureCctDashboard(env.googleSheetId);
  } catch (error) {
    console.warn('[WORKSPACE] CCT publicada, mas o painel do Sheets não pôde ser preparado:', error);
    return;
  }
  const empresasVinculadas = await prisma.enquadramentoSindical.findMany({
    where: { sindicato: { cnpj: cnpjSindicato }, status: STATUS_ENQUADRAMENTO.CONFIRMADO },
    select: { cliente: { select: { razaoSocial: true, cnpj: true } } },
    orderBy: { cliente: { razaoSocial: 'asc' } }
  });
  await appendRowToSheet(env.googleSheetId, [
    new Date().toISOString(),
    empresasVinculadas.map(({ cliente }) => `${cliente.razaoSocial} (${cliente.cnpj})`).join('; '),
    `${sindicatoNome} (${cnpjSindicato})`,
    descreverImpacto(cct._count.impactosFolha, cct.resumoCct),
    linkPdf
  ]);
}

async function selecionarFila() {
  const agora = new Date();
  const limite = new Date(agora.getTime() - env.mteStaleAfterHours * 60 * 60 * 1_000);
  const mesAtual = agora.getMonth() + 1;

  return prisma.sindicato.findMany({
    where: {
      ativo: true,
      enquadramentos: { some: { status: STATUS_ENQUADRAMENTO.CONFIRMADO } },
      AND: [
        { OR: [{ proximaTentativa: null }, { proximaTentativa: { lte: agora } }] },
        { OR: [
          { ultimaVarredura: null },
          { ultimaVarredura: { lt: limite } },
          { mesDataBase: mesAtual }
        ] }
      ]
    },
    orderBy: [{ ultimaVarredura: 'asc' }, { atualizadoEm: 'asc' }],
    take: env.mteBatchSize,
    select: { id: true, cnpj: true, razaoSocial: true, mesDataBase: true, falhasConsecutivas: true }
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
      await syncAdminSheets();
    } catch (error) {
      console.error('[SYNC] Cadastros da planilha não sincronizados; a fila usará os dados já existentes no banco:', error);
    }

    try {
      await sincronizarMatrizEnquadramento();
    } catch (error) {
      console.warn('[WORKSPACE] Matriz de enquadramento não sincronizada; a fila segue normalmente:', error);
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
        const textoBruto = await buscarESalvarCCT(sindicato.cnpj, anoVigencia);
        const parametros = await extrairCctComIa(textoBruto);

        await persistirExtracaoCct(sindicato.cnpj, anoVigencia, parametros);
        await publicarCctNoWorkspace(sindicato.cnpj, anoVigencia, sindicato.razaoSocial);
        await prisma.sindicato.update({
          where: { id: sindicato.id },
          data: { ultimaVarredura: new Date(), proximaTentativa: null, falhasConsecutivas: 0 }
        });
        console.info(`[MTE] CCT processada e extraída para ${sindicato.cnpj}`);
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
