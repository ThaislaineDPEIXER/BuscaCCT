import test from 'node:test';
import assert from 'node:assert/strict';

import { runWithGeminiModelFallback } from '../src/services/geminiModelFallback';

test('tenta modelos alternativos do Gemini quando o primeiro retorna 404', async () => {
  const tentativas: string[] = [];
  const genAI = {
    getGenerativeModel: ({ model }: { model: string }) => ({ modelName: model })
  } as any;

  const resultado = await runWithGeminiModelFallback(genAI, 'gemini-2.5-flash', {}, async ({ modelName }) => {
    tentativas.push(modelName);
    if (modelName === 'gemini-2.5-flash') {
      throw { status: 404, message: 'models/gemini-2.5-flash is not found for API version v1beta' };
    }
    return modelName;
  });

  assert.equal(resultado, 'gemini-2.0-flash');
  assert.deepEqual(tentativas, ['gemini-2.5-flash', 'gemini-2.0-flash']);
});
