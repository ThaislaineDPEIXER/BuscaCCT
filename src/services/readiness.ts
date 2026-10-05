import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { prisma } from '../db';

const anthropic = env.anthropicApiKey ? new Anthropic({ apiKey: env.anthropicApiKey }) : null;
const gemini = env.geminiApiKey ? new GoogleGenerativeAI(env.geminiApiKey) : null;

export type HealthStatus = 'ok' | 'falha';
export type AiProvider = 'anthropic' | 'gemini';

export type ReadinessResult = {
  status: 'ok' | 'degradado';
  postgres: HealthStatus;
  ai: HealthStatus;
  aiProvider: AiProvider;
  anthropic?: HealthStatus;
  gemini?: HealthStatus;
  erro?: string;
};

type AiProbe = () => Promise<void>;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
  ]);
}

export async function verificarDisponibilidadeIa(
  provider: AiProvider,
  probes: { anthropic: AiProbe; gemini: AiProbe }
): Promise<{ ai: HealthStatus; erro?: string; anthropic?: HealthStatus; gemini?: HealthStatus }> {
  try {
    if (provider === 'gemini') {
      await probes.gemini();
      return { ai: 'ok', gemini: 'ok' };
    }

    await probes.anthropic();
    return { ai: 'ok', anthropic: 'ok' };
  } catch (error) {
    const mensagem = `${provider === 'gemini' ? 'Gemini' : 'Anthropic'}: ${String(error)}`;
    return provider === 'gemini'
      ? { ai: 'falha', gemini: 'falha', erro: mensagem }
      : { ai: 'falha', anthropic: 'falha', erro: mensagem };
  }
}

async function probeAnthropic(): Promise<void> {
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY nao configurada');
  await withTimeout(anthropic.beta.models.list({ limit: 1 }), 5_000);
}

async function probeGemini(): Promise<void> {
  if (!gemini) throw new Error('GEMINI_API_KEY nao configurada');
  const model = gemini.getGenerativeModel({
    model: env.geminiModel,
    generationConfig: { temperature: 0, maxOutputTokens: 1 }
  });
  await withTimeout(model.generateContent('Responda apenas OK.'), 5_000);
}

export async function verificarReadiness(): Promise<ReadinessResult> {
  const aiProvider = env.aiProvider as AiProvider;
  let postgres: HealthStatus = 'ok';
  let erro: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    postgres = 'falha';
    erro = `PostgreSQL: ${String(error)}`;
  }

  const ia = await verificarDisponibilidadeIa(aiProvider, {
    anthropic: probeAnthropic,
    gemini: probeGemini
  });
  if (ia.erro) erro = `${erro ? `${erro}; ` : ''}${ia.erro}`;

  const status = postgres === 'ok' && ia.ai === 'ok' ? 'ok' : 'degradado';
  return {
    status,
    postgres,
    ai: ia.ai,
    aiProvider,
    ...(ia.anthropic ? { anthropic: ia.anthropic } : {}),
    ...(ia.gemini ? { gemini: ia.gemini } : {}),
    ...(erro ? { erro } : {})
  };
}
