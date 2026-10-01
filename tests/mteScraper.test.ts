import test from 'node:test';
import assert from 'node:assert/strict';

import { anoMaisRecenteDisponivel, CctAccessBlockedError, CctCaptchaRequiredError, CctUnavailableError, detectarDesafioAntiBot, detectarSemResultadosMediador, deveIgnorarPendenciaManual, formatarCnpj, temTextoCctUtilizavel } from '../src/tools/mteScraper';

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

test('detectarSemResultadosMediador reconhece respostas vazias com ou sem acentos', () => {
  assert.equal(detectarSemResultadosMediador('Nenhum instrumento coletivo encontrado'), true);
  assert.equal(detectarSemResultadosMediador('Não foram encontrados registros'), true);
  assert.equal(detectarSemResultadosMediador('Resultados da pesquisa'), false);
});

test('pendência manual só bloqueia nova consulta sem retry explícito', () => {
  assert.equal(deveIgnorarPendenciaManual('PENDENTE_DOWNLOAD_MANUAL', false), true);
  assert.equal(deveIgnorarPendenciaManual('PENDENTE_DOWNLOAD_MANUAL', true), false);
  assert.equal(deveIgnorarPendenciaManual('EXTRAIDA', true), false);
});

test('cache vazio ou composto apenas por espaços não é um texto de CCT utilizável', () => {
  assert.equal(temTextoCctUtilizavel(undefined), false);
  assert.equal(temTextoCctUtilizavel(''), false);
  assert.equal(temTextoCctUtilizavel('   \n'), false);
  assert.equal(temTextoCctUtilizavel('Texto da convenção'), true);
});

test('fallback escolhe o ano mais recente sem ultrapassar o ano anterior', () => {
  assert.equal(anoMaisRecenteDisponivel(['Vigência 2025/2026', 'Registro 2024'], 2025), 2025);
  assert.equal(anoMaisRecenteDisponivel(['Vigência 2026/2027'], 2025), undefined);
});

test('CNPJ é formatado conforme a máscara do formulário do Mediador', () => {
  assert.equal(formatarCnpj('79831442000130'), '79.831.442/0001-30');
  assert.equal(formatarCnpj('79.831.442/0001-30'), '79.831.442/0001-30');
});
