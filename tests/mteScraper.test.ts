import test from 'node:test';
import assert from 'node:assert/strict';

import { CctCaptchaRequiredError, CctUnavailableError } from '../src/tools/mteScraper';

test('exceções do scraper devem manter a hierarquia correta', () => {
  const captcha = new CctCaptchaRequiredError('captchas');
  const indisponivel = new CctUnavailableError('indisponivel');

  assert.ok(captcha instanceof Error);
  assert.ok(indisponivel instanceof Error);
  assert.ok(captcha instanceof CctUnavailableError);
  assert.match(captcha.message, /captchas/i);
});
