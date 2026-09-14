import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { periodoDelMes, sumarCosto, sumarTokens } from './anthropic.js';

describe('traduccion de Claude', () => {
  it('suma las cuatro clases de token de todas las cubetas', () => {
    const respuesta = {
      data: [
        {
          results: [
            {
              uncached_input_tokens: 100,
              cached_input_tokens: 50,
              output_tokens: 25
            },
            { cache_creation_input_tokens: 10 }
          ]
        },
        { results: [{ uncached_input_tokens: 5 }] }
      ]
    };
    assert.equal(sumarTokens(respuesta), 190);
  });

  it('no truena con cubetas vacias ni campos ausentes', () => {
    assert.equal(sumarTokens({}), 0);
    assert.equal(sumarTokens({ data: [] }), 0);
    assert.equal(sumarTokens({ data: [{}] }), 0);
    assert.equal(sumarTokens({ data: [{ results: [{}] }] }), 0);
  });

  it('convierte el costo de centavos a unidades', () => {
    // La API entrega cadenas decimales en centavos; sumarlas tal cual daria una
    // cifra cien veces mas grande.
    const { total, moneda } = sumarCosto({
      data: [
        { results: [{ amount: '128450', currency: 'usd' }, { amount: '550' }] }
      ]
    });
    assert.equal(total, 1290);
    assert.equal(moneda, 'USD');
  });

  it('trata un importe ilegible como cero en vez de NaN', () => {
    const { total } = sumarCosto({
      data: [{ results: [{ amount: 'no es numero' }] }]
    });
    assert.equal(total, 0);
  });

  it('el periodo va del primero del mes al primero del siguiente', () => {
    const { inicio, fin } = periodoDelMes(new Date('2026-09-14T18:30:00Z'));
    assert.equal(inicio, '2026-09-01T00:00:00.000Z');
    assert.equal(fin, '2026-10-01T00:00:00.000Z');
  });

  it('cruza bien el fin de ano', () => {
    const { inicio, fin } = periodoDelMes(new Date('2026-12-31T23:59:00Z'));
    assert.equal(inicio, '2026-12-01T00:00:00.000Z');
    assert.equal(fin, '2027-01-01T00:00:00.000Z');
  });
});
