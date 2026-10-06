import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

import { env } from '../src/config/env';
import { notificarIndisponibilidadeProviderAi, resetOperationalNotifications } from '../src/services/operationalAlert';

const originalTiWebhookUrl = env.tiWebhookUrl;
const originalAxiosPost = axios.post;
const originalConsoleError = console.error;

test.beforeEach(() => {
  resetOperationalNotifications();
  env.tiWebhookUrl = 'https://ti.example.test/webhook';
  console.error = () => undefined;
});

test.afterEach(() => {
  resetOperationalNotifications();
  env.tiWebhookUrl = originalTiWebhookUrl;
  axios.post = originalAxiosPost;
  console.error = originalConsoleError;
});

test('notificarIndisponibilidadeProviderAi envia apenas um webhook por provider/motivo', async () => {
  const chamadas: Array<{ url: string; body: { text: string } }> = [];
  axios.post = (async (url: string, body: { text: string }) => {
    chamadas.push({ url, body });
    return { status: 200 } as never;
  }) as typeof axios.post;

  const reason = 'Anthropic indisponível: Your credit balance is too low to access the Anthropic API.';
  await notificarIndisponibilidadeProviderAi({ provider: 'anthropic', operation: 'extracao-cct', reason });
  await notificarIndisponibilidadeProviderAi({ provider: 'anthropic', operation: 'leitura-documento', reason });

  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0]?.url, 'https://ti.example.test/webhook');
  assert.match(chamadas[0]?.body.text ?? '', /Provider ANTHROPIC indisponível/);
  assert.match(chamadas[0]?.body.text ?? '', /failover desativado/);
});

test('notificarIndisponibilidadeProviderAi reaproveita a notificação se o webhook falhar', async () => {
  let tentativas = 0;
  axios.post = (async () => {
    tentativas += 1;
    if (tentativas === 1) {
      throw new Error('webhook offline');
    }
    return { status: 200 } as never;
  }) as typeof axios.post;

  const reason = 'Anthropic indisponível: Your credit balance is too low to access the Anthropic API.';
  await notificarIndisponibilidadeProviderAi({ provider: 'anthropic', operation: 'extracao-cct', reason });
  await notificarIndisponibilidadeProviderAi({ provider: 'anthropic', operation: 'extracao-cct', reason });

  assert.equal(tentativas, 2);
});
