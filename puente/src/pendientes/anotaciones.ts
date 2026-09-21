import type {
  Person,
  ReassignRequest,
  TaskComment,
  TaskEvent,
  TaskItem,
  TaskStatus,
  TaskUnread
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
  /** Quienes tambien le dan seguimiento, ademas del responsable. */
  seguidores?: Person[];
  /** Lo que la IA propuso como responsable y nadie ha decidido. */
  sugerencia?: SugerenciaResponsable;
  /** Llego un correo relacionado y nadie ha abierto el pendiente. */
  novedad?: TaskUnread;
  /** Claves de los correos ya anotados, para no repetir la nota. */
  correosAnotados?: string[];
  /** Ya se intento asignar solo (regla o IA); no se vuelve a gastar en eso. */
  autoAsignacionIntentada?: boolean;
  /** El responsable pidio que se lo quiten; se borra al decidir. */
  solicitudReasignacion?: ReassignRequest;
  actualizadoEn: string;
}

export interface SugerenciaResponsable {
  responsable: Person;
  motivo: string;
  at: string;
}

export type CambiosPendiente = Partial<
  Pick<
    TaskItem,
    | 'title'
    | 'description'
    | 'priority'
    | 'dueDate'
    | 'dueHasTime'
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
        followers: nota.seguidores?.length ? nota.seguidores : undefined,
        suggestedAssignee:
          nota.sugerencia && !nota.asignado
            ? {
                person: nota.sugerencia.responsable,
                reason: nota.sugerencia.motivo
              }
            : undefined,
        unread: nota.novedad,
        reassignRequest: nota.solicitudReasignacion,
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
  if ('dueHasTime' in cambios) {
    salida.dueHasTime = cambios.dueHasTime === true ? true : undefined;
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

/** La persona, por id o por correo (sin importar mayusculas). */
export function mismaPersona(a: Person, b: Person): boolean {
  const correoA = a.email?.toLowerCase();
  return a.id === b.id || (!!correoA && correoA === b.email?.toLowerCase());
}

/**
 * Agrega a alguien que da seguimiento, con su movimiento en el historial.
 * Si ya estaba (o es el responsable) devuelve la misma nota.
 */
export function conSeguidor(
  nota: Anotacion,
  persona: Person,
  ahora: string,
  por?: string
): Anotacion {
  if (
    (nota.asignado && mismaPersona(nota.asignado, persona)) ||
    nota.seguidores?.some((p) => mismaPersona(p, persona))
  ) {
    return nota;
  }
  return conEvento(
    {
      ...nota,
      seguidores: [...(nota.seguidores ?? []), persona],
      actualizadoEn: ahora
    },
    {
      at: ahora,
      by: por,
      kind: 'asignacion',
      text: `Da seguimiento: ${persona.name}`
    }
  );
}

/** Quita a alguien del seguimiento; si no estaba, la misma nota. */
export function sinSeguidor(
  nota: Anotacion,
  persona: Person,
  ahora: string,
  por?: string
): Anotacion {
  const quitado = nota.seguidores?.find((p) => mismaPersona(p, persona));
  if (!quitado) {
    return nota;
  }
  const seguidores = (nota.seguidores ?? []).filter((p) => p !== quitado);
  return conEvento(
    {
      ...nota,
      seguidores: seguidores.length > 0 ? seguidores : undefined,
      actualizadoEn: ahora
    },
    {
      at: ahora,
      by: por,
      kind: 'asignacion',
      text: `Deja de dar seguimiento: ${quitado.name}`
    }
  );
}

/** Guarda la propuesta de la IA para que alguien la acepte o la descarte. */
export function conSugerencia(
  nota: Anotacion,
  responsable: Person,
  motivo: string,
  ahora: string
): Anotacion {
  return conEvento(
    {
      ...nota,
      sugerencia: { responsable, motivo, at: ahora },
      autoAsignacionIntentada: true,
      actualizadoEn: ahora
    },
    {
      at: ahora,
      by: 'IA',
      kind: 'asignacion',
      text: `Sugiere a ${responsable.name}: ${motivo}`
    }
  );
}

/** Borra la propuesta (se descarto o ya se asigno a alguien). */
export function sinSugerencia(
  nota: Anotacion,
  ahora: string,
  por?: string,
  descartada = false
): Anotacion {
  if (!nota.sugerencia) {
    return nota;
  }
  const { sugerencia, ...resto } = nota;
  const limpia: Anotacion = { ...resto, actualizadoEn: ahora };
  return descartada
    ? conEvento(limpia, {
        at: ahora,
        by: por,
        kind: 'asignacion',
        text: `Sugerencia descartada: ${sugerencia.responsable.name}`
      })
    : limpia;
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

const ETIQUETA_CAMPO: Record<keyof CambiosPendiente, string> = {
  title: 'Título',
  description: 'Descripción',
  priority: 'Prioridad',
  dueDate: 'Fecha',
  dueHasTime: 'Hora',
  company: 'Empresa',
  project: 'Proyecto',
  senderKind: 'Remitente'
};

/**
 * Lo que cambio, en una linea para la trazabilidad: solo los campos cuyo
 * valor es distinto del que tenia el pendiente (el portal manda el
 * formulario completo). Sin el pendiente anterior se listan todos.
 */
export function describirCambios(
  cambios: CambiosPendiente,
  anterior?: Partial<TaskItem>
): string {
  const partes: string[] = [];
  for (const clave of Object.keys(cambios) as (keyof CambiosPendiente)[]) {
    if (clave === 'dueHasTime') {
      // Va implicito en la fecha: si hay hora, la fecha se muestra con ella.
      continue;
    }
    const nuevo = cambios[clave];
    const viejo = anterior?.[clave];
    if (anterior && igual(clave, nuevo, viejo)) {
      continue;
    }
    if (clave === 'description') {
      partes.push(nuevo ? 'Descripción editada' : 'Descripción borrada');
      continue;
    }
    const conHora =
      clave === 'dueDate' &&
      (cambios.dueHasTime === true || anterior?.dueHasTime === true);
    const de = anterior ? `${mostrar(clave, viejo, conHora)} → ` : '';
    partes.push(
      `${ETIQUETA_CAMPO[clave]}: ${de}${mostrar(clave, nuevo, conHora)}`
    );
  }
  return partes.join(' · ');
}

function igual(clave: keyof CambiosPendiente, a: unknown, b: unknown): boolean {
  if (clave === 'dueDate') {
    const fecha = (v: unknown) =>
      typeof v === 'string' && !Number.isNaN(Date.parse(v))
        ? new Date(v).toISOString()
        : '';
    return fecha(a) === fecha(b);
  }
  return (a ?? '') === (b ?? '');
}

function mostrar(
  clave: keyof CambiosPendiente,
  v: unknown,
  conHora = false
): string {
  if (v === undefined || v === null || v === '') {
    return '(vacío)';
  }
  if (clave === 'dueDate' && typeof v === 'string') {
    return new Date(v).toLocaleString('es-MX', {
      dateStyle: 'medium',
      timeStyle: conHora ? 'short' : undefined,
      timeZone: 'America/Mexico_City'
    });
  }
  return String(v).slice(0, 60);
}
