import { Observable, delay, of } from 'rxjs';
import {
  CrmActivity,
  CrmOpportunity,
  Meeting,
  MonitorTarget,
  SourceKind,
  TaskItem
} from '../../models';
import {
  CalendarSource,
  CrmSource,
  DateRange,
  MonitorSource,
  TaskSource
} from '../source.contracts';
import { demoActivities, demoOpportunities } from './demo-crm';
import { demoPersonalMeetings, demoWorkMeetings } from './demo-meetings';
import { demoMonitorTargets } from './demo-monitors';
import { demoOdooTasks, demoOpsTasks } from './demo-tasks';

/**
 * Adaptadores de demostración.
 *
 * Entregan datos inventados con un retraso pequeno para que las pantallas
 * pasen de verdad por su estado de carga: si respondieran al instante nunca
 * veríamos si los esqueletos de carga quedaron bien.
 */
const FAKE_LATENCY_MS = 450;

function emit<T>(value: T): Observable<T> {
  return of(value).pipe(delay(FAKE_LATENCY_MS));
}

export class DemoTaskSource implements TaskSource {
  readonly demo = true;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: SourceKind,
    private readonly accountId: string
  ) {}

  fetchTasks(): Observable<TaskItem[]> {
    const now = new Date();
    const tasks =
      this.kind === 'odoo'
        ? demoOdooTasks(this.accountId, now)
        : demoOpsTasks(this.accountId, now);
    return emit(tasks);
  }
}

export class DemoCalendarSource implements CalendarSource {
  readonly demo = true;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: SourceKind,
    private readonly accountId: string
  ) {}

  fetchMeetings(range: DateRange): Observable<Meeting[]> {
    const now = new Date();
    const all =
      this.kind === 'microsoft'
        ? demoPersonalMeetings(this.accountId, now)
        : demoWorkMeetings(this.accountId, now);
    const from = new Date(range.from).getTime();
    const to = new Date(range.to).getTime();
    const inRange = all.filter((meeting) => {
      const start = new Date(meeting.start).getTime();
      return start >= from && start <= to;
    });
    return emit(inRange);
  }
}

export class DemoMonitorSource implements MonitorSource {
  readonly demo = true;
  readonly kind: SourceKind = 'monitor';

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly accountId: string
  ) {}

  fetchTargets(): Observable<MonitorTarget[]> {
    return emit(demoMonitorTargets(this.accountId));
  }
}

export class DemoCrmSource implements CrmSource {
  readonly demo = true;
  readonly kind: SourceKind = 'odoo';

  constructor(
    readonly id: string,
    readonly label: string,
    private readonly accountId: string
  ) {}

  fetchOpportunities(): Observable<CrmOpportunity[]> {
    return emit(demoOpportunities(this.accountId));
  }

  fetchActivities(): Observable<CrmActivity[]> {
    return emit(demoActivities(this.accountId));
  }
}
