import test from 'node:test';
import assert from 'node:assert/strict';

import { CctAccessBlockedError, CctCaptchaRequiredError, CctUnavailableError, detectarDesafioAntiBot, deveIgnorarPendenciaManual } from '../src/tools/mteScraper';

test('exceções do scraper devem manter a hierarquia correta', () => {
  const captcha = new CctCaptchaRequiredError('captchas');
  const bloqueado = new CctAccessBlockedError('bloqueado');
  const indisponivel = new CctUnavailableError('indisponivel');

  assert.ok(captcha instanceof Error);
  assert.ok(indisponivel instanceof Error);
  assert.ok(captcha instanceof CctUnavailableError);
  assert.ok(bloqueado instanceof CctUnavailableError);
  assert.match(captcha.message, /captchas/i);
});

test('detectarDesafioAntiBot reconhece as telas bloqueadas do Mediador', () => {
  assert.equal(detectarDesafioAntiBot('Just a moment', 'Checking your browser before accessing mediador.trabalho.gov.br'), true);
  assert.equal(detectarDesafioAntiBot('Mediador', 'Acesso bloqueado por desafio anti-bot'), true);
  assert.equal(detectarDesafioAntiBot('Consulta de CCT', 'Resultado da busca'), false);
});

test('pendência manual só bloqueia nova consulta sem retry explícito', () => {
  assert.equal(deveIgnorarPendenciaManual('PENDENTE_DOWNLOAD_MANUAL', false), true);
  assert.equal(deveIgnorarPendenciaManual('PENDENTE_DOWNLOAD_MANUAL', true), false);
  assert.equal(deveIgnorarPendenciaManual('EXTRAIDA', true), false);
});
