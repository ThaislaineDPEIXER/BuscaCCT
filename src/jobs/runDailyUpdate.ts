import { env } from '../config/env';
import { executarFilaMte } from './dailyUpdate';

async function main(): Promise<void> {
  console.info(`[AI] Worker configurado com provider primário=${env.aiProvider}, fallback=${env.aiFallbackProvider}, failover=${env.aiFallbackConfigured ? 'ativo' : 'inativo'}, geminiModel=${env.geminiModel}, geminiFallbacks=${env.geminiModelCandidates.join(' -> ')}, anthropicModel=${env.anthropicModel}`);
  if (!env.aiFallbackConfigured) {
    console.warn(`[AI] Failover automático desativado: ${env.aiFallbackProvider.toUpperCase()} não configurado. Falhas transitórias do provedor principal não terão fallback.`);
  }
  await executarFilaMte();
}

void main().catch(error => {
  console.error('[WORKER] Falha na execução noturna:', error);
  process.exit(1);
});
