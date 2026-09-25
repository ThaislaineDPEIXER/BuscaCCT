import { executarFilaMte } from './dailyUpdate';

async function main(): Promise<void> {
  await executarFilaMte();
}

void main().catch(error => {
  console.error('[WORKER] Falha na execução noturna:', error);
  process.exit(1);
});
