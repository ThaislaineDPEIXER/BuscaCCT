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

test('usa gemini-1.5-flash como default absoluto quando GEMINI_MODEL vier vazio', () => {
  assert.equal(resolveGeminiModel(undefined), 'gemini-1.5-flash');
  assert.equal(resolveGeminiModel(''), 'gemini-1.5-flash');
  assert.equal(resolveGeminiModel('   '), 'gemini-1.5-flash');
});

test('monta fallback de modelos Gemini preservando o preferido', () => {
  assert.deepEqual(resolveGeminiModelCandidates(undefined), ['gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.0-pro']);
  assert.deepEqual(resolveGeminiModelCandidates('gemini-1.5-flash-latest'), ['gemini-1.5-flash-latest', 'gemini-1.5-flash', 'gemini-1.0-pro']);
  assert.deepEqual(resolveGeminiModelCandidates('custom-model'), ['custom-model', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-1.0-pro']);
});
