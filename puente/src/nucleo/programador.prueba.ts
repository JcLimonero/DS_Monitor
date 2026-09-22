import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REVISION_MINUTOS } from './programador.js';

describe('REVISION_MINUTOS', () => {
  it('cada tipo de tarea mira el reloj a su ritmo, no todas cada 15 min', () => {
    assert.equal(REVISION_MINUTOS.vigilancia, 5);
    assert.ok(REVISION_MINUTOS.juntas > REVISION_MINUTOS.vigilancia);
    assert.ok(REVISION_MINUTOS.diario > REVISION_MINUTOS.avisos);
    assert.ok(REVISION_MINUTOS.semanal > REVISION_MINUTOS.diario);
    assert.notEqual(REVISION_MINUTOS.juntas, 15);
    assert.notEqual(REVISION_MINUTOS.diario, 15);
    assert.notEqual(REVISION_MINUTOS.semanal, 15);
  });
});
