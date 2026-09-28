import { lerDocumentoComIa } from './aiDocumentReader';

export async function extrairTextoPdf(pdf: Buffer): Promise<string> {
  const texto = await lerDocumentoComIa(pdf, 'application/pdf', {
    systemPrompt: 'Extraia somente o texto legivel deste PDF de uma Convencao Coletiva de Trabalho. Preserve numeros, percentuais, datas, valores monetarios e titulos de clausulas. Nao resuma e nao invente texto.',
    instrucao: 'Transcreva o texto integral legivel deste documento.',
    json: false,
    maxTokens: 20_000
  });
  if (!texto) throw new Error('A IA nao extraiu texto do PDF escaneado');
  return texto;
}
