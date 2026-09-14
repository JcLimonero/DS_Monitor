import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CrmActivity,
  CrmOpportunity,
  Meeting,
  MonitorTarget,
  SourceKind,
  TaskItem
} from '../models';

/**
 * Contratos que implementa cada integración.
 *
 * El portal no conoce a Odoo ni a Google: conoce estas cuatro interfaces. Para
 * conectar una fuente real basta con escribir una clase que las implemente y
 * registrarla en el token correspondiente; ninguna vista cambia.
 */
export interface PortalSource {
  readonly id: string;
  readonly label: string;
  readonly kind: SourceKind;
  /** True mientras la fuente entregue datos inventados y no reales. */
  readonly demo: boolean;
}

export interface TaskSource extends PortalSource {
  fetchTasks(): Observable<TaskItem[]>;
}

/** Rango de fechas que pide la agenda, en ISO. */
export interface DateRange {
  from: string;
  to: string;
}

export interface CalendarSource extends PortalSource {
  fetchMeetings(range: DateRange): Observable<Meeting[]>;
}

export interface MonitorSource extends PortalSource {
  fetchTargets(): Observable<MonitorTarget[]>;
}

export interface CrmSource extends PortalSource {
  fetchOpportunities(): Observable<CrmOpportunity[]>;
  fetchActivities(): Observable<CrmActivity[]>;
}

export const TASK_SOURCES = new InjectionToken<readonly TaskSource[]>(
  'TASK_SOURCES'
);
export const CALENDAR_SOURCES = new InjectionToken<readonly CalendarSource[]>(
  'CALENDAR_SOURCES'
);
export const MONITOR_SOURCES = new InjectionToken<readonly MonitorSource[]>(
  'MONITOR_SOURCES'
);
export const CRM_SOURCES = new InjectionToken<readonly CrmSource[]>(
  'CRM_SOURCES'
);
