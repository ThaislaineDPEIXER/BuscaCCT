import { GenerativeModel, GoogleGenerativeAI, ModelParams } from '@google/generative-ai';
import { resolveGeminiModelCandidates } from '../config/aiSettings';
import { isProviderCapabilityAiError } from './aiResilience';

type GeminiModelParams = Omit<ModelParams, 'model'>;
type GeminiRunner<T> = (input: { model: GenerativeModel; modelName: string }) => Promise<T>;

export async function runWithGeminiModelFallback<T>(
  genAI: GoogleGenerativeAI,
  preferredModel: string,
  modelParams: GeminiModelParams,
  runner: GeminiRunner<T>
): Promise<T> {
  const candidates = resolveGeminiModelCandidates(preferredModel);
  let lastError: unknown;

  for (let index = 0; index < candidates.length; index += 1) {
    const modelName = candidates[index];
    const model = genAI.getGenerativeModel({ model: modelName, ...modelParams });

    try {
      return await runner({ model, modelName });
    } catch (error) {
      lastError = error;
      const canFallback = isProviderCapabilityAiError(error) && index < candidates.length - 1;
      if (!canFallback) throw error;
      console.warn(`[AI] Modelo Gemini indisponível (${modelName}); tentando alternativa. Motivo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw lastError;
}
