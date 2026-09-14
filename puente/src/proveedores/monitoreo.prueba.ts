import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { disponibilidad, estadoDe } from './monitoreo.js';

const revision = (ok: boolean, latencyMs = 120) => ({
  at: new Date().toISOString(),
  ok,
  latencyMs
});

describe('monitoreo', () => {
  it('calcula la disponibilidad con un decimal', () => {
    assert.equal(
      disponibilidad([revision(true), revision(true), revision(true)]),
      100
    );
    assert.equal(disponibilidad([revision(true), revision(false)]), 50);
    assert.equal(
      disponibilidad([revision(true), revision(true), revision(false)]),
      66.7
    );
  });

  it('sin revisiones no reporta disponibilidad', () => {
    assert.equal(disponibilidad([]), 0);
  });

  it('responder lento es degradado, no operativo', () => {
    assert.equal(estadoDe(revision(true, 200)), 'operativo');
    assert.equal(estadoDe(revision(true, 1500)), 'degradado');
  });

  it('no responder es caido', () => {
    assert.equal(estadoDe(revision(false, 0)), 'caido');
  });

  it('sin revision el estado es desconocido, no operativo', () => {
    assert.equal(estadoDe(undefined), 'desconocido');
  });
});
