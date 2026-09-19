import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { conPrioridadPersonal } from './prioridad.js';

const base: TaskItem = {
  id: 'a',
  title: 'Ir al médico',
  status: 'pendiente',
  priority: 'baja',
  accountId: 'mios',
  origin: 'local',
  tags: [],
  updatedAt: '2026-09-18T12:00:00Z'
};

describe('conPrioridadPersonal', () => {
  it('lo personal sin fecha es alta', () => {
    assert.equal(
      conPrioridadPersonal({ ...base, personal: true }).priority,
      'alta'
    );
  });
  it('lo personal con fecha es urgente', () => {
    assert.equal(
      conPrioridadPersonal({
        ...base,
        personal: true,
        dueDate: '2026-09-20T18:00:00Z'
      }).priority,
      'urgente'
    );
  });
  it('lo del negocio no se toca', () => {
    assert.equal(conPrioridadPersonal(base).priority, 'baja');
  });
});
