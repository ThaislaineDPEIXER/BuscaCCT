import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAiProvider, resolveGeminiModel } from '../src/config/aiSettings';

test('normaliza AI_PROVIDER capitalizado e com alias comum', () => {
  assert.equal(normalizeAiProvider('GEMINI'), 'gemini');
  assert.equal(normalizeAiProvider('Google Gemini'), 'gemini');
  assert.equal(normalizeAiProvider('CLAUDE'), 'anthropic');
});

test('normaliza AI_PROVIDER traduzido com acento', () => {
  assert.equal(normalizeAiProvider('Antrópica'), 'anthropic');
});

test('usa gemini-1.5-flash como default absoluto quando GEMINI_MODEL vier vazio', () => {
  assert.equal(resolveGeminiModel(undefined), 'gemini-1.5-flash');
  assert.equal(resolveGeminiModel(''), 'gemini-1.5-flash');
  assert.equal(resolveGeminiModel('   '), 'gemini-1.5-flash');
});

