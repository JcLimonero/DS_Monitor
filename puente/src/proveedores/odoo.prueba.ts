import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  actividadesComoPendientes,
  etapaDesdeOdoo,
  fechaOdooAIso,
  prioridadPorVencimiento,
  tipoActividad
} from './odoo.js';

describe('traduccion de Odoo', () => {
  it('reconoce las etapas por su nombre', () => {
    assert.equal(etapaDesdeOdoo('Negociación', false, false), 'negociacion');
    assert.equal(
      etapaDesdeOdoo('Propuesta enviada', false, false),
      'propuesta'
    );
    assert.equal(etapaDesdeOdoo('Cotización', false, false), 'propuesta');
    assert.equal(etapaDesdeOdoo('Calificado', false, false), 'calificado');
  });

  it('ganado y perdido mandan sobre el nombre de la etapa', () => {
    assert.equal(etapaDesdeOdoo('Negociación', true, false), 'ganado');
    assert.equal(etapaDesdeOdoo('Negociación', false, true), 'perdido');
  });

  it('una etapa con nombre propio de la instancia cae en nuevo', () => {
    // Cada quien renombra sus etapas; lo conservador es no adelantar el embudo.
    assert.equal(etapaDesdeOdoo('Primer acercamiento', false, false), 'nuevo');
    assert.equal(etapaDesdeOdoo('', false, false), 'nuevo');
  });

  it('reconoce el tipo de actividad en espanol y en ingles', () => {
    assert.equal(tipoActividad('Llamada'), 'llamada');
    assert.equal(tipoActividad('Call'), 'llamada');
    assert.equal(tipoActividad('Enviar correo'), 'correo');
    assert.equal(tipoActividad('Email'), 'correo');
    assert.equal(tipoActividad('Reunión'), 'reunion');
    assert.equal(tipoActividad('Meeting'), 'reunion');
    assert.equal(tipoActividad('Cualquier otra cosa'), 'tarea');
  });

  it('convierte las fechas de Odoo a ISO en UTC', () => {
    assert.equal(
      fechaOdooAIso('2026-09-14 15:30:00'),
      '2026-09-14T15:30:00.000Z'
    );
  });

  it('ancla las fechas sin hora a mediodia', () => {
    // Odoo entrega los vencimientos como fecha sola; anclarlas a medianoche las
    // correria un dia hacia atras en husos al oeste de UTC.
    assert.equal(fechaOdooAIso('2026-09-14'), '2026-09-14T12:00:00.000Z');
  });

  it('trata false y vacio como sin fecha', () => {
    assert.equal(fechaOdooAIso(false), undefined);
    assert.equal(fechaOdooAIso(undefined), undefined);
    assert.equal(fechaOdooAIso('no es fecha'), undefined);
  });
});

describe('actividades del CRM vistas como pendientes', () => {
  const ahora = new Date('2026-09-14T12:00:00Z');

  it('deduce la prioridad del vencimiento', () => {
    assert.equal(
      prioridadPorVencimiento('2026-09-12T12:00:00Z', ahora),
      'urgente'
    );
    assert.equal(
      prioridadPorVencimiento('2026-09-14T12:00:00Z', ahora),
      'urgente'
    );
    assert.equal(
      prioridadPorVencimiento('2026-09-16T12:00:00Z', ahora),
      'alta'
    );
    assert.equal(
      prioridadPorVencimiento('2026-09-20T12:00:00Z', ahora),
      'media'
    );
    assert.equal(
      prioridadPorVencimiento('2026-10-30T12:00:00Z', ahora),
      'baja'
    );
  });

  it('traduce una actividad a pendiente sin perder el responsable ni la liga', () => {
    const [pendiente] = actividadesComoPendientes(
      [
        {
          id: '7',
          summary: 'Llamar a compras',
          type: 'llamada',
          dueDate: '2026-09-15T10:00:00Z',
          responsible: { id: '3', name: 'Juan Carlos' },
          opportunityId: '42',
          opportunityName: 'Integración de inventario',
          accountId: 'itech',
          url: 'https://odoo.example.com/odoo/crm/42'
        }
      ],
      'itech',
      ahora
    );

    assert.equal(pendiente?.id, 'odoo-7');
    assert.equal(pendiente?.title, 'Llamar a compras');
    assert.equal(pendiente?.origin, 'odoo');
    assert.equal(pendiente?.status, 'pendiente');
    assert.equal(pendiente?.priority, 'alta');
    assert.equal(pendiente?.assignee?.name, 'Juan Carlos');
    assert.equal(pendiente?.description, 'Integración de inventario');
    assert.equal(pendiente?.url, 'https://odoo.example.com/odoo/crm/42');
    assert.deepEqual(pendiente?.tags, ['crm', 'llamada']);
  });

  it('el identificador no choca con los de otras fuentes', () => {
    // Sin el prefijo, la actividad 1 de Odoo y la tarea 1 de Ops tendrian el
    // mismo id y el portal mostraria solo una de las dos.
    const [pendiente] = actividadesComoPendientes(
      [
        {
          id: '1',
          summary: 'x',
          type: 'tarea',
          dueDate: ahora.toISOString(),
          accountId: 'itech'
        }
      ],
      'itech',
      ahora
    );
    assert.equal(pendiente?.id, 'odoo-1');
  });
});
