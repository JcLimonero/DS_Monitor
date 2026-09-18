import type {
  Person,
  TaskComment,
  TaskEvent,
  TaskItem,
  TaskStatus
} from '../nucleo/contrato.js';

/**
 * Lo que se le agrega a un pendiente desde el portal, venga de donde venga:
 * comentarios, si ya se hizo, y a quien se le asigno. La fuente (el correo,
 * Ops, Odoo) no se entera; la anotacion se pone encima al servir la lista, y
 * si la fuente deja de mandar el pendiente, la anotacion simplemente no se
 * usa.
 */
export interface Anotacion {
  hecho?: boolean;
  /** Estado elegido a mano; manda sobre el de la fuente. */
  estado?: TaskStatus;
  /** Todo lo que se le ha hecho, en orden. */
  historial?: TaskEvent[];
  /**
   * Borrado desde el portal. La fuente lo puede seguir mandando (un correo
   * no se va), pero ya no se sirve: es la forma de sacar de la lista lo que
   * ya se hizo y no hace falta ver mas.
   */
  eliminado?: boolean;
  /** Lo que se edito desde el portal: titulo, fecha, prioridad, empresa, proyecto. */
  cambios?: CambiosPendiente;
  comentarios: TaskComment[];
  asignado?: Person;
  actualizadoEn: string;
}

export type CambiosPendiente = Partial<
  Pick<
    TaskItem,
    | 'title'
    | 'description'
    | 'priority'
    | 'dueDate'
    | 'company'
    | 'project'
    | 'senderKind'
  >
>;

export type Anotaciones = Record<string, Anotacion>;

/** Las tareas con sus anotaciones encima. */
export function anotar(
  tareas: TaskItem[],
  anotaciones: Anotaciones
): TaskItem[] {
  return tareas
    .filter((tarea) => !anotaciones[tarea.id]?.eliminado)
    .map((tarea) => {
      const nota = anotaciones[tarea.id];
      if (!nota) {
        return tarea;
      }
      return {
        ...tarea,
        ...limpiarCambios(nota.cambios),
        status: nota.hecho
          ? 'hecho'
          : (nota.estado ??
            (tarea.status === 'hecho' && nota.hecho === false
              ? 'pendiente'
              : tarea.status)),
        assignee: nota.asignado ?? tarea.assignee,
        history: nota.historial?.length ? nota.historial : tarea.history,
        comments:
          nota.comentarios.length > 0 ? nota.comentarios : tarea.comments,
        updatedAt:
          nota.actualizadoEn > tarea.updatedAt
            ? nota.actualizadoEn
            : tarea.updatedAt
      };
    });
}

/** Solo los campos permitidos y con valor; `null` en dueDate/company los quita. */
export function limpiarCambios(
  cambios: CambiosPendiente | undefined
): CambiosPendiente {
  if (!cambios) {
    return {};
  }
  const salida: CambiosPendiente = {};
  if (typeof cambios.title === 'string' && cambios.title.trim()) {
    salida.title = cambios.title.trim().slice(0, 160);
  }
  if (typeof cambios.description === 'string') {
    salida.description = cambios.description.trim() || undefined;
  }
  if (
    cambios.priority &&
    ['baja', 'media', 'alta', 'urgente'].includes(cambios.priority)
  ) {
    salida.priority = cambios.priority;
  }
  if ('dueDate' in cambios) {
    salida.dueDate =
      typeof cambios.dueDate === 'string' &&
      !Number.isNaN(Date.parse(cambios.dueDate))
        ? new Date(cambios.dueDate).toISOString()
        : undefined;
  }
  if ('company' in cambios) {
    salida.company =
      typeof cambios.company === 'string' && cambios.company.trim()
        ? cambios.company.trim()
        : undefined;
  }
  if (
    cambios.senderKind &&
    ['empresa', 'equipo', 'por_identificar'].includes(cambios.senderKind)
  ) {
    salida.senderKind = cambios.senderKind;
  }
  if ('project' in cambios) {
    salida.project =
      typeof cambios.project === 'string' && cambios.project.trim()
        ? cambios.project.trim()
        : undefined;
  }
  return salida;
}

/** Agrega un movimiento al historial de la anotacion (las ultimas 200). */
export function conEvento(
  nota: Anotacion,
  evento: Omit<TaskEvent, 'at'> & { at?: string }
): Anotacion {
  const entrada: TaskEvent = {
    at: evento.at ?? new Date().toISOString(),
    ...evento
  };
  return {
    ...nota,
    historial: [...(nota.historial ?? []), entrada].slice(-200)
  };
}
