import cron from 'node-cron';
import { env } from '../config/env';
import { prisma } from '../db';
import { extrairCctComClaude } from '../services/claudeAgent';
import { persistirExtracaoCct } from '../services/cctExtractionPersistence';
import { enviarDigest, gerarAlertasDataBase } from '../services/alertService';
import { notificarFalhaMte } from '../services/operationalAlert';
import { varrerSindicato } from '../services/radarDiscovery';
import { buscarESalvarCCT } from '../tools/mteScraper';

const pausar = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const delayAleatorio = (): number => {
  const minimo = Math.min(env.mteDelayMinMs, env.mteDelayMaxMs);
  const maximo = Math.max(env.mteDelayMinMs, env.mteDelayMaxMs);
  return Math.floor(Math.random() * (maximo - minimo + 1) + minimo);
};

let varreduraEmAndamento = false;

async function selecionarFila() {
  const agora = new Date();
  const limite = new Date(agora.getTime() - env.mteStaleAfterHours * 60 * 60 * 1_000);
  const mesAtual = agora.getMonth() + 1;

  return prisma.sindicato.findMany({
    where: {
      ativo: true,
      enquadramentos: { some: { status: 'VALIDADO_DP' } },
      OR: [
        { ultimaVarredura: null },
        { ultimaVarredura: { lt: limite } },
        { mesDataBase: mesAtual }
      ]
    },
    orderBy: [{ ultimaVarredura: 'asc' }, { atualizadoEm: 'asc' }],
    take: env.mteBatchSize,
    select: { id: true, cnpj: true, razaoSocial: true, mesDataBase: true }
  });
}

export async function executarFilaMte(): Promise<void> {
  if (varreduraEmAndamento) {
    console.warn('[MTE] Fila anterior ainda está em execução; nova execução ignorada.');
    return;
  }

  varreduraEmAndamento = true;
  try {
    const sindicatos = await selecionarFila();
    console.info(`[MTE] ${sindicatos.length} sindicatos selecionados para a fila.`);

    for (const sindicato of sindicatos) {
      try {
        console.info(`[MTE] Processando ${sindicato.cnpj} (${sindicato.razaoSocial})`);
        const anoVigencia = new Date().getFullYear();
        const textoBruto = await buscarESalvarCCT(sindicato.cnpj, anoVigencia);
        const parametros = await extrairCctComClaude(textoBruto);

        await persistirExtracaoCct(sindicato.cnpj, anoVigencia, parametros);
        console.info(`[MTE] CCT processada e extraída para ${sindicato.cnpj}`);
      } catch (error) {
        console.error(`[MTE] Falha no CNPJ ${sindicato.cnpj}:`, error);
        await notificarFalhaMte(sindicato.cnpj, error);
      } finally {
        await prisma.sindicato.update({ where: { id: sindicato.id }, data: { ultimaVarredura: new Date() } });
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
      where: { ativo: true, enquadramentos: { some: { status: 'VALIDADO_DP' } } },
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
