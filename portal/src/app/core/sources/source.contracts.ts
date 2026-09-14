import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import {
  CrmActivity,
  CrmOpportunity,
  Deployment,
  LicenseUsage,
  Meeting,
  MonitorTarget,
  PlatformStatus,
  RepoStatus,
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

export interface LicenseSource extends PortalSource {
  fetchLicenses(): Observable<LicenseUsage[]>;
}

export interface RepoSource extends PortalSource {
  fetchRepos(): Observable<RepoStatus[]>;
}

export interface DeploymentSource extends PortalSource {
  fetchDeployments(): Observable<Deployment[]>;
  /** Estado del proveedor mismo, para separar "falló mi build" de "está caído". */
  fetchPlatformStatus(): Observable<PlatformStatus[]>;
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
export const LICENSE_SOURCES = new InjectionToken<readonly LicenseSource[]>(
  'LICENSE_SOURCES'
);
export const DEPLOYMENT_SOURCES = new InjectionToken<
  readonly DeploymentSource[]
>('DEPLOYMENT_SOURCES');
export const REPO_SOURCES = new InjectionToken<readonly RepoSource[]>(
  'REPO_SOURCES'
);
