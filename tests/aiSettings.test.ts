import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAiProvider, resolveGeminiModel, resolveGeminiModelCandidates } from '../src/config/aiSettings';

test('normaliza AI_PROVIDER capitalizado e com alias comum', () => {
  assert.equal(normalizeAiProvider('GEMINI'), 'gemini');
  assert.equal(normalizeAiProvider('Google Gemini'), 'gemini');
  assert.equal(normalizeAiProvider('CLAUDE'), 'anthropic');
});

test('normaliza AI_PROVIDER traduzido com acento', () => {
  assert.equal(normalizeAiProvider('Antrópica'), 'anthropic');
});

test('usa gemini-3.8-flash como default quando GEMINI_MODEL vier vazio', () => {
  assert.equal(resolveGeminiModel(undefined), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel(''), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel('   '), 'gemini-3.8-flash');
});

test('monta fallback de modelos Gemini preservando o preferido', () => {
  assert.deepEqual(resolveGeminiModelCandidates(undefined), ['gemini-3.8-flash']);
  assert.deepEqual(resolveGeminiModelCandidates('custom-model'), ['custom-model', 'gemini-3.8-flash']);
});
