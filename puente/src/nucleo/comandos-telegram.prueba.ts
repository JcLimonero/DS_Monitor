import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { interpretarComando } from './comandos-telegram.js';

describe('comandos del bot', () => {
  it('reconoce los comandos con o sin @bot', () => {
    assert.deepEqual(interpretarComando('/hoy'), { tipo: 'hoy' });
    assert.deepEqual(interpretarComando('/servicios@ds_monitor_limon_bot'), {
      tipo: 'servicios'
    });
    assert.deepEqual(interpretarComando('/pendientes'), { tipo: 'pendientes' });
    assert.deepEqual(interpretarComando('/ayuda'), { tipo: 'ayuda' });
  });

  it('una pregunta empieza con ? o /ia', () => {
    assert.deepEqual(interpretarComando('¿qué vence esta semana?'), {
      tipo: 'pregunta',
      texto: 'qué vence esta semana?'
    });
    assert.deepEqual(interpretarComando('/ia quién tiene más carga'), {
      tipo: 'pregunta',
      texto: 'quién tiene más carga'
    });
  });

  it('lo demás es dictado', () => {
    assert.equal(
      interpretarComando('Junta con Felipe el lunes a las 12'),
      undefined
    );
    assert.equal(interpretarComando('/otro'), undefined);
  });
});
