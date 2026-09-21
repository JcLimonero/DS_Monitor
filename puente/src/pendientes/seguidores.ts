import type { Person, TaskItem } from '../nucleo/contrato.js';
import { mismaPersona } from './anotaciones.js';

/**
 * Quien ve que desde su liga personal: lo que tiene a su nombre y lo que
 * sigue. El responsable es uno; los que dan seguimiento pueden comentar y
 * cambiar el estado, pero no pedir que se reasigne (eso es del responsable).
 */

export function esResponsable(tarea: TaskItem, persona: Person): boolean {
  return !!tarea.assignee && mismaPersona(tarea.assignee, persona);
}

export function esSeguidor(tarea: TaskItem, persona: Person): boolean {
  return (tarea.followers ?? []).some((p) => mismaPersona(p, persona));
}

/** Los pendientes de la persona y cuales de ellos ve solo por seguimiento. */
export function pendientesDePersona(
  tareas: readonly TaskItem[],
  persona: Person,
  soloTarea?: string
): { pendientes: TaskItem[]; seguimiento: string[] } {
  const pendientes = tareas.filter(
    (t) =>
      (!soloTarea || t.id === soloTarea) &&
      (esResponsable(t, persona) || esSeguidor(t, persona))
  );
  return {
    pendientes,
    seguimiento: pendientes
      .filter((t) => !esResponsable(t, persona))
      .map((t) => t.id)
  };
}
