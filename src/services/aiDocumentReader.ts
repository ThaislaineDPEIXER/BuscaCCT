import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';

export const MIME_TYPES_SUPORTADOS = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type MimeSuportado = typeof MIME_TYPES_SUPORTADOS[number];

export type LeituraDocumentoIa = { systemPrompt: string; instrucao: string; json: boolean; maxTokens: number };
type Leitura = LeituraDocumentoIa;
type DriverLeitura = (documento: Buffer, mimeType: MimeSuportado, leitura: Leitura) => Promise<string>;

export function mimeSuportado(mimeType: string | null | undefined): mimeType is MimeSuportado {
  return (MIME_TYPES_SUPORTADOS as readonly string[]).includes(mimeType ?? '');
}

export async function executarLeituraComIaPorProvider(
  provider: 'anthropic' | 'gemini',
  documento: Buffer,
  mimeType: MimeSuportado,
  leitura: Leitura,
  drivers: { gemini: DriverLeitura; anthropic: DriverLeitura }
): Promise<string> {
  if (documento.length === 0) throw new Error('Documento vazio.');
  return provider === 'gemini'
    ? drivers.gemini(documento, mimeType, leitura)
    : drivers.anthropic(documento, mimeType, leitura);
}

let anthropic: Anthropic | null = null;
let gemini: GoogleGenerativeAI | null = null;

async function lerComGemini(documento: Buffer, mimeType: MimeSuportado, leitura: Leitura): Promise<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY nao configurada');
  gemini ??= new GoogleGenerativeAI(env.geminiApiKey);
  const model = gemini.getGenerativeModel({
    model: env.geminiModel,
    systemInstruction: leitura.systemPrompt,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: leitura.maxTokens,
      ...(leitura.json ? { responseMimeType: 'application/json' } : {})
    }
  });
  const resposta = await model.generateContent([
    { inlineData: { data: documento.toString('base64'), mimeType } },
    { text: leitura.instrucao }
  ]);
  return resposta.response.text().trim();
}

async function lerComClaude(documento: Buffer, mimeType: MimeSuportado, leitura: Leitura): Promise<string> {
  if (!env.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY nao configurada');
  anthropic ??= new Anthropic({ apiKey: env.anthropicApiKey });
  const data = documento.toString('base64');
  const anexo: Anthropic.ContentBlockParam = mimeType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data } };

  const resposta = await anthropic.messages.create({
    model: env.anthropicVisionModel,
    max_tokens: leitura.maxTokens,
    temperature: 0,
    system: leitura.systemPrompt,
    messages: [{ role: 'user', content: [anexo, { type: 'text', text: leitura.instrucao }] }]
  });
  return resposta.content
    .filter((item): item is Anthropic.TextBlock => item.type === 'text')
    .map(item => item.text)
    .join('\n')
    .trim();
}

export async function lerDocumentoComIa(documento: Buffer, mimeType: MimeSuportado, leitura: Leitura): Promise<string> {
  return executarLeituraComIaPorProvider(env.aiProvider as 'anthropic' | 'gemini', documento, mimeType, leitura, {
    gemini: lerComGemini,
    anthropic: lerComClaude
  });
}
