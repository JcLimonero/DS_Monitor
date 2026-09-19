import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fuentesPrometheus } from '../config/entorno.js';
import { saludDe } from './prometheus.js';

describe('salud de un VPS', () => {
  it('sin reportar es sin señal', () => {
    assert.equal(saludDe({ online: false }).health, 'sin_senal');
  });
  it('bien cuando todo está bajo umbral', () => {
    assert.deepEqual(
      saludDe({ online: true, cpuPct: 20, memPct: 50, diskPct: 40 }),
      { health: 'bien', reason: undefined }
    );
  });
  it('aviso por disco, memoria o CPU, y crítico por disco casi lleno', () => {
    assert.equal(saludDe({ online: true, diskPct: 86 }).health, 'aviso');
    assert.equal(saludDe({ online: true, memPct: 91 }).health, 'aviso');
    assert.equal(saludDe({ online: true, cpuPct: 90 }).health, 'aviso');
    const c = saludDe({ online: true, diskPct: 96, memPct: 95 });
    assert.equal(c.health, 'critico');
    assert.match(c.reason ?? '', /disco al 96 %, memoria al 95 %/);
  });
});

describe('lista de servidores Prometheus', () => {
  const comun = { usuario: 'u', etiquetaNombre: 'nombre', accountId: 'vps' };

  it('acepta una URL sola o varias líneas nombre|url', () => {
    assert.deepEqual(
      fuentesPrometheus('http://a:9090/', comun).map((f) => [f.nombre, f.url]),
      [[undefined, 'http://a:9090']]
    );
    assert.deepEqual(
      fuentesPrometheus(
        'Nexus 1|http://74.208.151.19:9090\n# comentario\nOperativAI|https://mon.op.ai\nbasura',
        comun
      ).map((f) => [f.nombre, f.url]),
      [
        ['Nexus 1', 'http://74.208.151.19:9090'],
        ['OperativAI', 'https://mon.op.ai']
      ]
    );
  });
});
