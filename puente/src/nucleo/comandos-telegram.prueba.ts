import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  interpretarComando,
  textoAutoasignacion
} from './comandos-telegram.js';
import { resumenVacio } from '../pendientes/autoasignar.js';

describe('comandos del bot', () => {
  it('reconoce los comandos con o sin @bot', () => {
    assert.deepEqual(interpretarComando('/hoy'), { tipo: 'hoy' });
    assert.deepEqual(interpretarComando('/servicios@ds_monitor_limon_bot'), {
      tipo: 'servicios'
    });
    assert.deepEqual(interpretarComando('/pendientes'), { tipo: 'pendientes' });
    assert.deepEqual(interpretarComando('/ayuda'), { tipo: 'ayuda' });
    assert.deepEqual(interpretarComando('/autoasignar'), {
      tipo: 'autoasignar'
    });
  });

  it('el barrido de autoasignación se cuenta con quién quedó cada uno', () => {
    const vacio = textoAutoasignacion(resumenVacio());
    assert.match(vacio, /Asignados 0 \(regla 0, IA 0\)/);
    assert.match(vacio, /No había pendientes/);
    const r = resumenVacio();
    r.revisados = 2;
    r.asignadosPorRegla.push({
      id: 'a',
      titulo: 'Factura <x>',
      responsable: 'Ana'
    });
    r.sugeridos.push({ id: 'b', titulo: 'Dominio', responsable: 'Luis' });
    r.omitidos = 1;
    const texto = textoAutoasignacion(r);
    assert.match(texto, /Asignados por regla/);
    assert.match(texto, /Factura &lt;x&gt; → Ana/);
    assert.match(texto, /Sugeridos \(esperan decisión\)/);
    assert.match(texto, /Quedaron 1 sin revisar/);
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
