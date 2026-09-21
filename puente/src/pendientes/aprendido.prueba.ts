import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import {
  aplicarAprendido,
  aprender,
  pistasParaModelo,
  responsableAprendido
} from './aprendido.js';

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

  it('aprende a quién se le asigna lo de un remitente y lo olvida al quitarlo', () => {
    const ana = { id: 'ana', name: 'Ana', email: 'ana@nexus.com', role: 'x' };
    const a = aprender({}, correo, {}, new Date(), ana);
    // Solo lo que identifica a la persona, sin el rol ni lo demas.
    assert.deepEqual(a['help@paddle.com']?.assignee, {
      id: 'ana',
      name: 'Ana',
      email: 'ana@nexus.com'
    });
    assert.deepEqual(responsableAprendido({ ...correo, id: 'y' }, a), {
      id: 'ana',
      name: 'Ana',
      email: 'ana@nexus.com'
    });
    assert.equal(
      responsableAprendido({ ...correo, origin: 'ops' }, a),
      undefined
    );
    assert.deepEqual(pistasParaModelo(a), ['help@paddle.com: lo atiende Ana']);
    // Una correccion posterior sin asignado conserva el responsable.
    const b = aprender(a, correo, { priority: 'alta' });
    assert.equal(b['help@paddle.com']?.assignee?.id, 'ana');
    // Quitarselo a mano lo olvida (y sin nada mas aprendido, la entrada sale).
    const c = aprender(a, correo, {}, new Date(), null);
    assert.equal(c['help@paddle.com'], undefined);
    assert.equal(
      aprender(b, correo, {}, new Date(), null)['help@paddle.com']?.assignee,
      undefined
    );
    // Sin cambio y sin asignado no se guarda nada.
    assert.deepEqual(aprender({}, correo, {}), {});
  });
});
