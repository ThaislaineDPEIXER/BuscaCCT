export type AiProvider = 'anthropic' | 'gemini';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.0-pro'
] as const;

function normalizeValue(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-');
}

export function normalizeAiProvider(value: string | undefined): AiProvider {
  const normalized = normalizeValue(value);

  if (!normalized) {
    return 'gemini';
  }

  if (['gemini', 'google', 'google-gemini', 'google-ai'].includes(normalized)) {
    return 'gemini';
  }

  if (['anthropic', 'anthropic-ai', 'claude', 'antropico', 'antropica'].includes(normalized)) {
    return 'anthropic';
  }

  throw new Error('AI_PROVIDER deve ser anthropic ou gemini');
}

export function resolveGeminiModel(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized ? normalized : DEFAULT_GEMINI_MODEL;
}

export function resolveGeminiModelCandidates(value: string | undefined): string[] {
  const preferred = resolveGeminiModel(value);
  return Array.from(new Set([preferred, DEFAULT_GEMINI_MODEL, ...GEMINI_MODEL_FALLBACKS]));
}
