export type AiProvider = 'anthropic' | 'gemini';

const RETRY_DELAYS_MS = [2_000, 5_000];
const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const TRANSIENT_CODE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timeout/i;
const PROVIDER_CAPABILITY_MESSAGE = /not found for api version|not supported for generatecontent|model[s]?\/.+not found|unsupported model|does not support/i;

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  const { message } = getErrorDetails(error);
  if (message) {
    return message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getErrorDetails(error: unknown): { status?: number; message: string; errorDetails: Array<Record<string, unknown>> } {
  if (!error || typeof error !== 'object') {
    return { message: String(error ?? ''), errorDetails: [] };
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    errorDetails?: unknown;
  };
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : undefined;

  return {
    status,
    message: typeof candidate.message === 'string' ? candidate.message : String(candidate.message ?? ''),
    errorDetails: Array.isArray(candidate.errorDetails)
      ? candidate.errorDetails.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      : []
  };
}

function isQuotaExhaustedAiError(error: unknown): boolean {
  const { status, message, errorDetails } = getErrorDetails(error);
  if (status !== 429) return false;

  if (/quota|free_tier|rate limit|billing details|retry in/i.test(message)) {
    return true;
  }

  return errorDetails.some(detail => {
    const type = String(detail['@type'] ?? '');
    return type.includes('QuotaFailure') || type.includes('RetryInfo');
  });
}

function isProviderCapabilityAiError(error: unknown): boolean {
  const { status, message } = getErrorDetails(error);
  if (status !== 404 && status !== 400) return false;
  return PROVIDER_CAPABILITY_MESSAGE.test(message);
}

function shouldRetryAiError(error: unknown): boolean {
  return isTransientAiError(error) && !isQuotaExhaustedAiError(error);
}

export function isTransientAiError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown; cause?: unknown };
  const status = typeof candidate.status === 'number'
    ? candidate.status
    : typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : undefined;
  if (status && TRANSIENT_STATUS.has(status)) return true;

  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const message = typeof candidate.message === 'string' ? candidate.message : String(candidate.message ?? '');
  if (TRANSIENT_CODE.test(code) || TRANSIENT_CODE.test(message)) return true;

  return Boolean(candidate.cause && isTransientAiError(candidate.cause));
}

async function runWithRetries<T>(label: string, worker: () => Promise<T>, delaysMs = RETRY_DELAYS_MS): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;
      const retryable = shouldRetryAiError(error);
      const delay = delaysMs[attempt];
      if (!retryable || delay === undefined) break;
      console.warn(`[AI] ${label} falhou na tentativa ${attempt + 1}; nova tentativa em ${Math.round(delay / 1_000)}s. Motivo: ${errorMessage(error)}`);
      await wait(delay);
    }
  }

  throw lastError;
}

export async function runWithAiProviderFallback<T>(input: {
  provider: AiProvider;
  operation: string;
  handlers: Partial<Record<AiProvider, () => Promise<T>>>;
  delaysMs?: number[];
}): Promise<T> {
  const { provider, operation, handlers, delaysMs } = input;
  const primary = handlers[provider];
  const fallbackProvider: AiProvider = provider === 'gemini' ? 'anthropic' : 'gemini';
  const fallback = handlers[fallbackProvider];

  if (!primary) {
    if (!fallback) throw new Error(`Handler de IA ausente para o provedor ${provider}.`);
    console.warn(`[AI] ${operation} sem handler para ${provider}; usando ${fallbackProvider} automaticamente.`);
    return runWithRetries(`${operation}/${fallbackProvider}`, fallback, delaysMs);
  }

  try {
    return await runWithRetries(`${operation}/${provider}`, primary, delaysMs);
  } catch (error) {
    const fallbackableError = isTransientAiError(error) || isProviderCapabilityAiError(error);
    if (!fallbackableError) throw error;

    if (!fallback) {
      throw new Error(
        `[AI] ${operation} falhou no provedor ${provider} e o failover para ${fallbackProvider} não está configurado. Configure a chave do provedor secundário para ativar o fallback automático.`,
        { cause: error }
      );
    }

    console.warn(`[AI] ${operation} falhou no ${provider}; alternando automaticamente para ${fallbackProvider}. Motivo: ${errorMessage(error)}`);
    return runWithRetries(`${operation}/${fallbackProvider}`, fallback, delaysMs);
  }
}
