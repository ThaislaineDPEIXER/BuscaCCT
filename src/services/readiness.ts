import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';
import { prisma } from '../db';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export async function verificarReadiness(): Promise<{ status: 'ok' | 'degradado'; postgres: 'ok' | 'falha'; anthropic: 'ok' | 'falha'; erro?: string }> {
  let postgres: 'ok' | 'falha' = 'ok';
  let anthropicStatus: 'ok' | 'falha' = 'ok';
  let erro: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    postgres = 'falha';
    erro = `PostgreSQL: ${String(error)}`;
  }

  try {
    await Promise.race([
      anthropic.beta.models.list({ limit: 1 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5_000))
    ]);
  } catch (error) {
    anthropicStatus = 'falha';
    erro = `${erro ? `${erro}; ` : ''}Anthropic: ${String(error)}`;
  }

  const status = postgres === 'ok' && anthropicStatus === 'ok' ? 'ok' : 'degradado';
  return { status, postgres, anthropic: anthropicStatus, ...(erro ? { erro } : {}) };
}