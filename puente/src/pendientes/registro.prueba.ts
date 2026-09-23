import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { registrar } from './registro.js';

function correo(
  id: string,
  fecha: string,
  titulo = 'Tu plan vence hoy',
  remitente = 'Zoom <no-reply@zoom.us>',
  accountId = 'correo-itech'
): TaskItem {
  return {
    id,
    title: titulo,
    description: `De: ${remitente}\nAsunto: ${titulo}`,
    status: 'pendiente',
    priority: 'media',
    dueDate: fecha,
    accountId,
    origin: 'correo',
    tags: ['correo'],
    updatedAt: fecha
  };
}

describe('registrar pendientes', () => {
  it('el mismo correo con otro id se fusiona al viejo y un correo nuevo entra', () => {
    const viejo = correo('correo-itech-12', '2026-09-01T10:00:00.000Z');
    const detectado = correo('correo-itech-k7ab', '2026-09-10T10:00:00.000Z');
    const nuevo = correo(
      'correo-itech-99',
      '2026-09-12T10:00:00.000Z',
      'Action needed - payment failed',
      'SendGrid <billing@sendgrid.com>'
    );
    const resultado = registrar([viejo], [detectado, nuevo], new Set());
    assert.deepEqual(resultado.map((t) => t.id).sort(), [
      'correo-itech-12',
      'correo-itech-99'
    ]);
    const fusionado = resultado.find((t) => t.id === 'correo-itech-12');
    assert.equal(fusionado?.updatedAt, '2026-09-10T10:00:00.000Z');
    assert.equal(fusionado?.dueDate, '2026-09-10T10:00:00.000Z');
    assert.equal(
      resultado.some((t) => t.id === 'correo-itech-k7ab'),
      false
    );
  });

  it('si el mismo correo ya estaba varias veces, se queda el id mas antiguo', () => {
    const antiguo = correo('id-viejo', '2026-08-01T00:00:00.000Z');
    const reciente = correo('id-nuevo', '2026-09-01T00:00:00.000Z');
    const detectado = correo('id-graph', '2026-09-15T00:00:00.000Z');
    const resultado = registrar([reciente, antiguo], [detectado], new Set());
    assert.deepEqual(
      resultado.map((t) => t.id),
      ['id-viejo']
    );
    assert.equal(resultado[0]?.title, 'Tu plan vence hoy');
    assert.equal(resultado[0]?.updatedAt, '2026-09-15T00:00:00.000Z');
  });

  it('lo que no es correo sigue registrandose por id', () => {
    const manual = (id: string, title: string): TaskItem => ({
      id,
      title,
      status: 'pendiente',
      priority: 'baja',
      accountId: 'local',
      origin: 'local',
      tags: [],
      updatedAt: '2026-09-01T00:00:00.000Z'
    });
    const resultado = registrar(
      [manual('a', 'Llamar')],
      [manual('a', 'Llamar hoy'), manual('b', 'Otro')],
      new Set()
    );
    assert.deepEqual(resultado.map((t) => t.id).sort(), ['a', 'b']);
    assert.equal(resultado.find((t) => t.id === 'a')?.title, 'Llamar hoy');
  });
});
