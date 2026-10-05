export type AiProvider = 'anthropic' | 'gemini';

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
  return normalized ? normalized : 'gemini-1.5-flash';
}

