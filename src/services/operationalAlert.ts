import axios from 'axios';
import { env } from '../config/env';

export async function notificarFalhaMte(cnpjSindicato: string, erro: unknown): Promise<void> {
  if (!env.tiWebhookUrl) return;

  const mensagem = `[FALHA NO ROBO DO MTE] CNPJ ${cnpjSindicato}. Motivo: ${String(erro)}`;
  try {
    await axios.post(env.tiWebhookUrl, { text: mensagem }, { timeout: 10_000 });
  } catch (webhookError) {
    console.error('[OPERACAO] Falha ao enviar webhook para a TI:', webhookError);
  }
}
