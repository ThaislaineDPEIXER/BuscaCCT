import axios from 'axios';
import { env } from '../config/env';

type AiProvider = 'anthropic' | 'gemini';

const notificacoesEnviadas = new Set<string>();

function descreverErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  if (erro && typeof erro === 'object' && 'message' in erro && typeof (erro as { message?: unknown }).message === 'string') {
    return (erro as { message: string }).message;
  }

  try {
    return JSON.stringify(erro);
  } catch {
    return String(erro);
  }
}

async function enviarWebhookTi(texto: string): Promise<boolean> {
  if (!env.tiWebhookUrl) return false;

  try {
    await axios.post(env.tiWebhookUrl, { text: texto }, { timeout: 10_000 });
    return true;
  } catch (webhookError) {
    console.error('[OPERACAO] Falha ao enviar webhook para a TI:', webhookError);
    return false;
  }
}

export async function notificarFalhaMte(cnpjSindicato: string, erro: unknown): Promise<void> {
  if (!env.tiWebhookUrl) return;

  const mensagem = `[FALHA NO ROBO DO MTE] CNPJ ${cnpjSindicato}. Motivo: ${descreverErro(erro)}`;
  await enviarWebhookTi(mensagem);
}

export async function notificarIndisponibilidadeProviderAi(input: { provider: AiProvider; operation: string; reason: string }): Promise<void> {
  if (!env.tiWebhookUrl) return;

  const { provider, operation, reason } = input;
  const chave = `ai-provider-unavailable:${provider}:${reason}`;
  if (notificacoesEnviadas.has(chave)) return;

  notificacoesEnviadas.add(chave);
  const enviado = await enviarWebhookTi(
    `[AI] Provider ${provider.toUpperCase()} indisponível no worker; failover desativado até reinício do processo. Operação: ${operation}. Motivo: ${reason}`
  );

  if (!enviado) notificacoesEnviadas.delete(chave);
}

export function resetOperationalNotifications(): void {
  notificacoesEnviadas.clear();
}
