import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  conRevision,
  disponibilidad,
  disponibilidad30,
  estadoDe,
  urlHttpAlterna
} from './monitoreo.js';

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

  it('https tiene alternativa http; http no', () => {
    assert.equal(
      urlHttpAlterna('https://ejemplo.mx/ruta'),
      'http://ejemplo.mx/ruta'
    );
    assert.equal(urlHttpAlterna('http://ejemplo.mx'), undefined);
    assert.equal(urlHttpAlterna('no-es-url'), undefined);
  });
});

describe('historial persistente de monitoreo', () => {
  const en = (iso: string, ok: boolean) => ({ at: iso, ok, latencyMs: 100 });

  it('guarda 24 h de revisiones y conteos por día', () => {
    let h = conRevision(
      undefined,
      en('2026-09-17T10:00:00Z', true),
      new Date('2026-09-17T10:00:00Z')
    );
    h = conRevision(
      h,
      en('2026-09-17T12:00:00Z', false),
      new Date('2026-09-17T12:00:00Z')
    );
    h = conRevision(
      h,
      en('2026-09-18T11:00:00Z', true),
      new Date('2026-09-18T11:00:00Z')
    );
    // La de las 10:00 del 17 ya tiene más de 24 h a las 11:00 del 18.
    assert.deepEqual(
      h.checks.map((c) => c.at),
      ['2026-09-17T12:00:00Z', '2026-09-18T11:00:00Z']
    );
    assert.deepEqual(h.dias, {
      '2026-09-17': { ok: 1, total: 2 },
      '2026-09-18': { ok: 1, total: 1 }
    });
    assert.equal(disponibilidad30(h), 66.7);
  });

  it('olvida los días de hace más de 30', () => {
    const viejo = { checks: [], dias: { '2026-08-01': { ok: 5, total: 5 } } };
    const h = conRevision(
      viejo,
      en('2026-09-18T11:00:00Z', true),
      new Date('2026-09-18T11:00:00Z')
    );
    assert.deepEqual(Object.keys(h.dias), ['2026-09-18']);
  });
});
