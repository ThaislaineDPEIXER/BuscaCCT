import { prisma } from './db';
import { startCronJobs } from './jobs/dailyUpdate';

console.info('[WORKER] Iniciando cron jobs do Radar de CCTs');
startCronJobs();

async function shutdown(signal: string): Promise<void> {
  console.info(`[WORKER] Recebido ${signal}, encerrando`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));