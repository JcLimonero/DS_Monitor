import { Person } from './common.model';

export type TaskStatus = 'pendiente' | 'en_progreso' | 'bloqueado' | 'hecho';
export type TaskPriority = 'baja' | 'media' | 'alta' | 'urgente';

/** De dónde salió el pendiente. Decide el icono y a donde lleva el enlace. */
export type TaskOrigin = 'odoo' | 'ops' | 'local';

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Fecha compromiso en ISO. Sin fecha significa que nadie la ha puesto. */
  dueDate?: string;
  /** A quien le toca. Sin responsable el pendiente sale como "sin asignar". */
  assignee?: Person;
  accountId: string;
  origin: TaskOrigin;
  /** Proyecto, tablero o equipo al que pertenece. */
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
