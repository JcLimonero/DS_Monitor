import { TaskItem, TaskOrigin, TaskPriority, TaskStatus } from '../../models';
import { addDays, atTime } from '../../util/date.util';
import { DEMO_PEOPLE } from './demo-people';

/** Plantilla de un pendiente de demostración, con el vencimiento en días. */
interface TaskSeed {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Días desde hoy. Negativo es vencido. `null` es sin fecha. */
  dueInDays: number | null;
  dueHour?: number;
  assignee?: keyof typeof DEMO_PEOPLE;
  project?: string;
  tags: string[];
  /** Días desde hoy de la última actualización, siempre en el pasado. */
  updatedDaysAgo: number;
}

const OPS_SEEDS: TaskSeed[] = [
  {
    id: 'ops-1',
    title: 'Cerrar el modal de detalles de ordenes',
    description:
      'Faltan los campos de la orden y el eco del envío a Salesforce.',
    status: 'en_progreso',
    priority: 'alta',
    dueInDays: 0,
    dueHour: 18,
    assignee: 'ana',
    project: 'VGD SF Track',
    tags: ['frontend', 'sprint-24'],
    updatedDaysAgo: 0
  },
  {
    id: 'ops-2',
    title: 'Reintentos del envío a Salesforce',
    description:
      'La cola se queda con los registros que fallan por token vencido.',
    status: 'bloqueado',
    priority: 'urgente',
    dueInDays: -2,
    dueHour: 13,
    assignee: 'bruno',
    project: 'Integración SF',
    tags: ['backend', 'integración'],
    updatedDaysAgo: 1
  },
  {
    id: 'ops-3',
    title: 'Plan de pruebas del tablero de inventario',
    status: 'pendiente',
    priority: 'media',
    dueInDays: 2,
    dueHour: 12,
    assignee: 'carla',
    project: 'VGD SF Track',
    tags: ['qa'],
    updatedDaysAgo: 2
  },
  {
    id: 'ops-4',
    title: 'Rotar el certificado de apisvanguardia',
    description: 'Vence a fin de mes y la renovación sigue siendo manual.',
    status: 'pendiente',
    priority: 'alta',
    dueInDays: 5,
    dueHour: 10,
    assignee: 'diego',
    project: 'Infraestructura',
    tags: ['infra', 'seguridad'],
    updatedDaysAgo: 3
  },
  {
    id: 'ops-5',
    title: 'Tablero de leads con el corte diario',
    status: 'en_progreso',
    priority: 'media',
    dueInDays: 4,
    dueHour: 17,
    assignee: 'elena',
    project: 'DWH',
    tags: ['datos'],
    updatedDaysAgo: 0
  },
  {
    id: 'ops-6',
    title: 'Revisar el consumo de la API de inventario',
    description: 'Subió 40% la semana pasada sin que creciera el tráfico.',
    status: 'pendiente',
    priority: 'baja',
    dueInDays: null,
    assignee: 'bruno',
    project: 'Integración SF',
    tags: ['backend'],
    updatedDaysAgo: 6
  },
  {
    id: 'ops-7',
    title: 'Aprobar el diseño del portal de facturación',
    status: 'pendiente',
    priority: 'alta',
    dueInDays: 1,
    dueHour: 11,
    assignee: 'yo',
    project: 'Facturación',
    tags: ['decisión'],
    updatedDaysAgo: 1
  },
  {
    id: 'ops-8',
    title: 'Migrar los estilos de @import a @use',
    status: 'hecho',
    priority: 'baja',
    dueInDays: -4,
    dueHour: 16,
    assignee: 'ana',
    project: 'VGD SF Track',
    tags: ['frontend', 'deuda-técnica'],
    updatedDaysAgo: 4
  }
];

const ODOO_SEEDS: TaskSeed[] = [
  {
    id: 'odoo-t-1',
    title: 'Enviar propuesta a Grupo Delta',
    description: 'Quedó de mandarse el desglose de licencias y soporte.',
    status: 'pendiente',
    priority: 'urgente',
    dueInDays: 0,
    dueHour: 15,
    assignee: 'yo',
    project: 'Embudo Itech',
    tags: ['crm', 'propuesta'],
    updatedDaysAgo: 0
  },
  {
    id: 'odoo-t-2',
    title: 'Llamada de seguimiento con Automotriz del Norte',
    status: 'pendiente',
    priority: 'alta',
    dueInDays: -1,
    dueHour: 9,
    assignee: 'yo',
    project: 'Embudo Itech',
    tags: ['crm', 'llamada'],
    updatedDaysAgo: 1
  },
  {
    id: 'odoo-t-3',
    title: 'Renovación anual de Servicios Peninsular',
    status: 'en_progreso',
    priority: 'media',
    dueInDays: 9,
    dueHour: 12,
    assignee: 'yo',
    project: 'Embudo Itech',
    tags: ['crm', 'renovación'],
    updatedDaysAgo: 2
  }
];

const LOCAL_SEEDS: TaskSeed[] = [
  {
    id: 'local-1',
    title: 'Armar el orden del día del comité del jueves',
    status: 'pendiente',
    priority: 'media',
    dueInDays: 3,
    dueHour: 8,
    project: 'Personal',
    tags: ['junta'],
    updatedDaysAgo: 1
  },
  {
    id: 'local-2',
    title: 'Revisar el presupuesto de infraestructura del trimestre',
    status: 'pendiente',
    priority: 'alta',
    dueInDays: 6,
    dueHour: 10,
    project: 'Personal',
    tags: ['presupuesto'],
    updatedDaysAgo: 5
  }
];

function toTask(
  seed: TaskSeed,
  origin: TaskOrigin,
  accountId: string,
  now: Date
): TaskItem {
  const assignee = seed.assignee ? DEMO_PEOPLE[seed.assignee] : undefined;
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description,
    status: seed.status,
    priority: seed.priority,
    dueDate:
      seed.dueInDays === null
        ? undefined
        : atTime(
            addDays(now, seed.dueInDays),
            seed.dueHour ?? 12
          ).toISOString(),
    assignee,
    accountId,
    origin,
    project: seed.project,
    url:
      origin === 'local'
        ? undefined
        : `https://${origin}.example.com/tarea/${seed.id}`,
    tags: seed.tags,
    updatedAt: addDays(now, -seed.updatedDaysAgo).toISOString()
  };
}

export function demoOpsTasks(accountId: string, now = new Date()): TaskItem[] {
  return OPS_SEEDS.map((seed) => toTask(seed, 'ops', accountId, now));
}

export function demoOdooTasks(accountId: string, now = new Date()): TaskItem[] {
  return ODOO_SEEDS.map((seed) => toTask(seed, 'odoo', accountId, now));
}

/** Semilla de pendientes propios, solo para el primer arranque del portal. */
export function demoLocalTasks(
  accountId: string,
  now = new Date()
): TaskItem[] {
  return LOCAL_SEEDS.map((seed) => toTask(seed, 'local', accountId, now));
}
