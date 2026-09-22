import { Person } from './common.model';

export type TaskStatus = 'pendiente' | 'en_progreso' | 'bloqueado' | 'hecho';
export type TaskPriority = 'baja' | 'media' | 'alta' | 'urgente';

/** De dónde salió el pendiente. Decide el icono y a donde lleva el enlace. */
export type TaskOrigin = 'odoo' | 'ops' | 'local' | 'correo';

/** De quién viene un pendiente de correo. */
export type SenderKind = 'empresa' | 'equipo' | 'por_identificar';

export const SENDER_KIND_LABEL: Record<SenderKind, string> = {
  empresa: 'De empresas',
  equipo: 'Del equipo',
  por_identificar: 'Por identificar'
};

/** Un comentario puesto desde el portal sobre un pendiente. */
export interface TaskComment {
  text: string;
  at: string;
  by?: string;
}

/** Un movimiento en la vida de un pendiente: quien, cuando y que. */
export interface TaskEvent {
  at: string;
  by?: string;
  kind:
    | 'comentario'
    | 'estado'
    | 'asignacion'
    | 'edicion'
    | 'eliminado'
    | 'solicitud';
  text: string;
}

/** Alguien del equipo pidió, desde su liga, que le quiten un pendiente. */
export interface ReassignRequest {
  /** Quién lo pide (nombre). */
  by: string;
  reason?: string;
  at: string;
}

/**
 * Llegó algo nuevo al pendiente y nadie lo ha visto: un correo relacionado
 * o la respuesta de alguien del equipo desde su liga.
 */
export interface TaskUnread {
  at: string;
  /** Resumen corto de lo que llegó. */
  text: string;
  /** De dónde viene; sin valor, correo (lo de antes). */
  kind?: 'correo' | 'respuesta';
}

/** Se le pidió una actualización a los responsables y no han contestado. */
export interface UpdateRequest {
  at: string;
  /** Correos a los que se les pidió. */
  to: string[];
}

/** La IA propone responsable; alguien decide si se asigna. */
export interface SuggestedAssignee {
  person: Person;
  reason: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  /**
   * Fotos del detalle (data URLs de imagen). Van con el pendiente propio y
   * se muestran en la tarjeta y en /mio.
   */
  imagenes?: string[];
  /** Comentarios capturados en el portal, el más reciente al final. */
  comments?: TaskComment[];
  /** Trazabilidad: comentarios, cambios de estado, asignaciones y ediciones. */
  history?: TaskEvent[];
  /** Empresa a la que pertenece: el nombre de una del catálogo (Integraciones → Empresas). */
  company?: string;
  /**
   * Personal, no del negocio. Vive en Personales y no sale en el tablero, el
   * carrusel ni los resúmenes del equipo.
   */
  personal?: boolean;
  /** Otras cuentas donde llegó el mismo pendiente (el mismo correo en dos buzones). */
  alsoIn?: string[];
  /** Quién lo pide (correo): una empresa, alguien de las empresas propias, o por identificar. */
  senderKind?: SenderKind;
  status: TaskStatus;
  priority: TaskPriority;
  /** Fecha compromiso en ISO. Sin fecha significa que nadie la ha puesto. */
  dueDate?: string;
  /** La fecha lleva hora concreta; si no, es "para ese día". */
  dueHasTime?: boolean;
  /** El responsable pidió que se lo reasignen; pendiente de decidir. */
  reassignRequest?: ReassignRequest;
  /** A quien le toca. Sin responsable el pendiente sale como "sin asignar". */
  assignee?: Person;
  /** Quiénes también le dan seguimiento, además del responsable. */
  followers?: Person[];
  /** Responsable que propone la IA, todavía sin asignar. */
  suggestedAssignee?: SuggestedAssignee;
  /** Novedad (correo o respuesta del equipo) que nadie ha abierto todavía. */
  unread?: TaskUnread;
  /** Se pidió actualización a los responsables; se borra cuando contestan. */
  updateRequested?: UpdateRequest;
  accountId: string;
  origin: TaskOrigin;
  /**
   * Cliente o proveedor externo: el nombre de uno del catálogo
   * (Integraciones → Proveedores).
   */
  project?: string;
  /** Enlace al sistema de origen para abrir el pendiente ahí. */
  url?: string;
  tags: string[];
  updatedAt: string;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  bloqueado: 'Bloqueado',
  hecho: 'Hecho'
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente'
};

/** Orden de mayor a menor urgencia, para ordenar listas. */
export const TASK_PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgente: 0,
  alta: 1,
  media: 2,
  baja: 3
};

/** Un pendiente cuenta como abierto mientras no este hecho. */
export function isOpen(task: TaskItem): boolean {
  return task.status !== 'hecho';
}
