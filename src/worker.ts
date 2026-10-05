import { env } from './config/env';
import { prisma } from './db';
import { startCronJobs } from './jobs/dailyUpdate';

console.info('[WORKER] Iniciando cron jobs do Radar de CCTs');
if (!env.aiFallbackConfigured) {
  console.warn(`[AI] Failover automático desativado: ${env.aiFallbackProvider.toUpperCase()} não configurado. Falhas transitórias do provedor principal não terão fallback.`);
}
startCronJobs();

async function shutdown(signal: string): Promise<void> {
  console.info(`[WORKER] Recebido ${signal}, encerrando`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
