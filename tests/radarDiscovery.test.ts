import test from 'node:test';
import assert from 'node:assert/strict';

import { devePreservarCctMteComoFontePrincipal } from '../src/services/radarDiscovery';

test('fallback do site preserva MTE apenas quando a CCT oficial já está utilizável', () => {
  assert.equal(devePreservarCctMteComoFontePrincipal(null), false);
  assert.equal(devePreservarCctMteComoFontePrincipal({ fonteTipo: 'MTE', status: 'PENDENTE_DOWNLOAD_MANUAL', textoCompleto: '' }), false);
  assert.equal(devePreservarCctMteComoFontePrincipal({ fonteTipo: 'SITE', status: 'CAPTURADA', textoCompleto: 'PDF do sindicato' }), false);
  assert.equal(devePreservarCctMteComoFontePrincipal({ fonteTipo: 'MTE', status: 'EXTRAIDA', textoCompleto: 'Texto oficial do Mediador' }), true);
});
