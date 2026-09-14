import {
  CRM_STAGE_ORDER,
  CrmOpportunity,
  CrmStage,
  Meeting,
  MonitorTarget,
  Person,
  TASK_PRIORITY_WEIGHT,
  TaskItem,
  isOpen,
  needsAttention
} from '../models';
import { DueBucket, dueBucket, isOverdue, isSameDay } from '../util/date.util';

/** Funciones puras sobre las colecciones del almacén. Sin estado ni inyección. */

export function openTasks(tasks: readonly TaskItem[]): TaskItem[] {
  return tasks.filter(isOpen);
}

export function overdueTasks(
  tasks: readonly TaskItem[],
  now = new Date()
): TaskItem[] {
  return openTasks(tasks).filter((task) => isOverdue(task.dueDate, now));
}

export function tasksDueToday(
  tasks: readonly TaskItem[],
  now = new Date()
): TaskItem[] {
  return openTasks(tasks).filter(
    (task) => dueBucket(task.dueDate, now) === 'hoy'
  );
}

export function tasksOf(
  tasks: readonly TaskItem[],
  personId: string
): TaskItem[] {
  return tasks.filter((task) => task.assignee?.id === personId);
}

/** Ordena por urgencia: primero lo vencido, luego por prioridad y fecha. */
export function byUrgency(a: TaskItem, b: TaskItem, now = new Date()): number {
  const overdueDiff =
    Number(isOverdue(b.dueDate, now)) - Number(isOverdue(a.dueDate, now));
  if (overdueDiff !== 0) {
    return overdueDiff;
  }
  const priorityDiff =
    TASK_PRIORITY_WEIGHT[a.priority] - TASK_PRIORITY_WEIGHT[b.priority];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  // Sin fecha se va al final: no compite con lo que si tiene compromiso.
  const aDue = a.dueDate
    ? new Date(a.dueDate).getTime()
    : Number.MAX_SAFE_INTEGER;
  const bDue = b.dueDate
    ? new Date(b.dueDate).getTime()
    : Number.MAX_SAFE_INTEGER;
  return aDue - bDue;
}

export interface TaskGroup {
  bucket: DueBucket;
  tasks: TaskItem[];
}

export function groupByDue(
  tasks: readonly TaskItem[],
  order: DueBucket[],
  now = new Date()
): TaskGroup[] {
  return order
    .map((bucket) => ({
      bucket,
      tasks: tasks
        .filter((task) => dueBucket(task.dueDate, now) === bucket)
        .sort((a, b) => byUrgency(a, b, now))
    }))
    .filter((group) => group.tasks.length > 0);
}

export function meetingsOn(meetings: readonly Meeting[], day: Date): Meeting[] {
  return meetings
    .filter((meeting) => isSameDay(new Date(meeting.start), day))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function upcomingMeetings(
  meetings: readonly Meeting[],
  now = new Date(),
  limit = 5
): Meeting[] {
  return meetings
    .filter((meeting) => new Date(meeting.end).getTime() >= now.getTime())
    .filter((meeting) => meeting.status !== 'cancelada')
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
}

/**
 * Pares de juntas que se empalman.
 *
 * Es el motivo principal de juntar los calendarios en una sola vista: los
 * choques entre cuentas distintas son los que nadie ve a tiempo.
 */
export function meetingConflicts(
  meetings: readonly Meeting[]
): [Meeting, Meeting][] {
  const active = meetings
    .filter((meeting) => meeting.status !== 'cancelada')
    .sort((a, b) => a.start.localeCompare(b.start));
  const pairs: [Meeting, Meeting][] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      // Ordenadas por inicio: en cuanto una empieza después del fin de `a`,
      // ninguna de las siguientes puede empalmarse con `a`.
      if (new Date(b.start).getTime() >= new Date(a.end).getTime()) {
        break;
      }
      pairs.push([a, b]);
    }
  }
  return pairs;
}

export function targetsNeedingAttention(
  targets: readonly MonitorTarget[]
): MonitorTarget[] {
  return targets.filter(needsAttention);
}

export interface StageSummary {
  stage: CrmStage;
  opportunities: CrmOpportunity[];
  total: number;
}

export function pipelineByStage(
  opportunities: readonly CrmOpportunity[]
): StageSummary[] {
  return CRM_STAGE_ORDER.map((stage) => {
    const items = opportunities
      .filter((opportunity) => opportunity.stage === stage)
      .sort((a, b) => b.amount - a.amount);
    return {
      stage,
      opportunities: items,
      total: items.reduce((sum, opportunity) => sum + opportunity.amount, 0)
    };
  });
}

/** Importe ponderado por probabilidad de las oportunidades aún abiertas. */
export function weightedPipeline(
  opportunities: readonly CrmOpportunity[]
): number {
  return opportunities
    .filter(
      (opportunity) =>
        opportunity.stage !== 'ganado' && opportunity.stage !== 'perdido'
    )
    .reduce(
      (sum, opportunity) =>
        sum + (opportunity.amount * opportunity.probability) / 100,
      0
    );
}

export interface TeamLoad {
  person: Person;
  open: number;
  overdue: number;
  dueToday: number;
  blocked: number;
  tasks: TaskItem[];
}

export function teamWorkload(
  tasks: readonly TaskItem[],
  now = new Date()
): TeamLoad[] {
  const byPerson = new Map<string, TeamLoad>();
  for (const task of tasks) {
    if (!task.assignee) {
      continue;
    }
    const current = byPerson.get(task.assignee.id) ?? {
      person: task.assignee,
      open: 0,
      overdue: 0,
      dueToday: 0,
      blocked: 0,
      tasks: []
    };
    current.tasks.push(task);
    if (isOpen(task)) {
      current.open++;
      if (isOverdue(task.dueDate, now)) {
        current.overdue++;
      }
      if (dueBucket(task.dueDate, now) === 'hoy') {
        current.dueToday++;
      }
      if (task.status === 'bloqueado') {
        current.blocked++;
      }
    }
    byPerson.set(task.assignee.id, current);
  }
  return [...byPerson.values()]
    .map((load) => ({
      ...load,
      tasks: load.tasks.sort((a, b) => byUrgency(a, b, now))
    }))
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}
