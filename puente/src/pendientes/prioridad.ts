import type { TaskItem } from '../nucleo/contrato.js';

/**
 * Lo personal siempre es alta, y urgente si tiene fecha: no se elige. Lo del
 * negocio se queda con la prioridad que traiga.
 */
export function conPrioridadPersonal(t: TaskItem): TaskItem {
  return t.personal ? { ...t, priority: t.dueDate ? 'urgente' : 'alta' } : t;
}
