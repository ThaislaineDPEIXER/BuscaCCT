import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env';

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

export async function extrairTextoPdfComClaude(pdf: Buffer): Promise<string> {
  const resposta = await anthropic.messages.create({
    model: env.anthropicVisionModel,
    max_tokens: 20_000,
    system: 'Extraia somente o texto legivel deste PDF de uma Convencao Coletiva de Trabalho. Preserve numeros, percentuais, datas, valores monetarios e titulos de clausulas. Nao resuma e nao invente texto.',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') }
        },
        { type: 'text', text: 'Transcreva o texto integral legivel deste documento.' }
      ]
    }]
  });

  const texto = resposta.content
    .filter((item): item is Anthropic.TextBlock => item.type === 'text')
    .map(item => item.text)
    .join('\n')
    .trim();
  if (!texto) throw new Error('Claude nao extraiu texto do PDF escaneado');
  return texto;
}
