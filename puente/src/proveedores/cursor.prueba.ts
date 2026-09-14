import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agruparUso, solicitudesDe } from './cursor.js';

describe('traduccion de Cursor', () => {
  it('suma las columnas de solicitudes', () => {
    assert.equal(
      solicitudesDe({ chatRequests: 10, composerRequests: 5, totalApplies: 2 }),
      17
    );
    assert.equal(solicitudesDe({}), 0);
  });

  it('junta los dias de una misma persona', () => {
    // La API entrega una fila por persona y por dia; la tarjeta muestra el mes.
    const porPersona = agruparUso({
      data: [
        { email: 'ana@example.com', chatRequests: 10 },
        { email: 'ana@example.com', chatRequests: 5, composerRequests: 3 },
        { email: 'bruno@example.com', totalApplies: 7 }
      ]
    });
    assert.equal(porPersona.get('ana@example.com')?.usado, 18);
    assert.equal(porPersona.get('bruno@example.com')?.usado, 7);
  });

  it('marca como activo a quien tuvo actividad algun dia', () => {
    const porPersona = agruparUso({
      data: [
        { email: 'carla@example.com', isActive: false, chatRequests: 0 },
        { email: 'carla@example.com', isActive: true, chatRequests: 4 }
      ]
    });
    assert.equal(porPersona.get('carla@example.com')?.activo, true);
  });

  it('quien ocupa asiento sin usarlo queda inactivo', () => {
    const porPersona = agruparUso({
      data: [{ email: 'diego@example.com', isActive: false, chatRequests: 0 }]
    });
    assert.equal(porPersona.get('diego@example.com')?.activo, false);
    assert.equal(porPersona.get('diego@example.com')?.usado, 0);
  });

  it('ignora filas sin correo en vez de agrupar bajo undefined', () => {
    const porPersona = agruparUso({ data: [{ chatRequests: 99 }] });
    assert.equal(porPersona.size, 0);
  });

  it('acepta el nombre alterno del campo de correo', () => {
    const porPersona = agruparUso({
      data: [{ userEmail: 'elena@example.com', chatRequests: 3 }]
    });
    assert.equal(porPersona.get('elena@example.com')?.usado, 3);
  });
});
