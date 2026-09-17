import type { Person, TaskComment, TaskItem } from '../nucleo/contrato.js';

/**
 * Lo que se le agrega a un pendiente desde el portal, venga de donde venga:
 * comentarios, si ya se hizo, y a quien se le asigno. La fuente (el correo,
 * Ops, Odoo) no se entera; la anotacion se pone encima al servir la lista, y
 * si la fuente deja de mandar el pendiente, la anotacion simplemente no se
 * usa.
 */
export interface Anotacion {
  hecho?: boolean;
  comentarios: TaskComment[];
  asignado?: Person;
  actualizadoEn: string;
}

export type Anotaciones = Record<string, Anotacion>;

/** Las tareas con sus anotaciones encima. */
export function anotar(tareas: TaskItem[], anotaciones: Anotaciones): TaskItem[] {
  return tareas.map((tarea) => {
    const nota = anotaciones[tarea.id];
    if (!nota) {
      return tarea;
    }
    return {
      ...tarea,
      status: nota.hecho ? 'hecho' : tarea.status === 'hecho' && nota.hecho === false ? 'pendiente' : tarea.status,
      assignee: nota.asignado ?? tarea.assignee,
      comments: nota.comentarios.length > 0 ? nota.comentarios : tarea.comments,
      updatedAt:
        nota.actualizadoEn > tarea.updatedAt ? nota.actualizadoEn : tarea.updatedAt
    };
  });
}
