import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { aplicarAprendido, aprender, pistasParaModelo } from './aprendido.js';

const correo: TaskItem = {
  id: 'x',
  title: 'Factura',
  description: 'De: Paddle <help@paddle.com>\nPara: yo',
  status: 'pendiente',
  priority: 'media',
  accountId: 'correo-nexus',
  origin: 'correo',
  tags: ['correo'],
  updatedAt: ''
};

describe('aprender de las correcciones', () => {
  it('guarda empresa y prioridad por remitente y las aplica despues', () => {
    const a = aprender({}, correo, { company: 'NexusQTech', priority: 'baja' });
    assert.equal(a['help@paddle.com']?.company, 'NexusQTech');
    assert.equal(a['help@paddle.com']?.veces, 1);
    const [t] = aplicarAprendido(
      [{ ...correo, id: 'y', company: undefined }],
      a
    );
    assert.equal(t?.company, 'NexusQTech');
    assert.deepEqual(pistasParaModelo(a), [
      'help@paddle.com: empresa NexusQTech: prioridad baja'
    ]);
  });

  it('ignora lo que no viene del correo y acumula veces', () => {
    const a = aprender({}, { ...correo, origin: 'local' }, { company: 'X' });
    assert.deepEqual(a, {});
    const b = aprender(aprender({}, correo, { company: 'A' }), correo, {
      priority: 'alta'
    });
    assert.equal(b['help@paddle.com']?.veces, 2);
    assert.equal(b['help@paddle.com']?.company, 'A');
    assert.equal(b['help@paddle.com']?.priority, 'alta');
  });
});
