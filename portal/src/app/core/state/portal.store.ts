import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';
import { PORTAL_CONFIG } from '../config/portal-config.token';
import {
  Account,
  CrmActivity,
  CrmOpportunity,
  Deployment,
  LicenseUsage,
  Meeting,
  MonitorTarget,
  PlatformStatus,
  SyncState,
  TaskItem
} from '../models';
import {
  CALENDAR_SOURCES,
  CRM_SOURCES,
  DEPLOYMENT_SOURCES,
  LICENSE_SOURCES,
  MONITOR_SOURCES,
  PortalSource,
  TASK_SOURCES
} from '../sources/source.contracts';
import { addDays, startOfDay } from '../util/date.util';

/** Cuanto abarca la agenda que se pide a los calendarios. */
const CALENDAR_DAYS_BACK = 7;
const CALENDAR_DAYS_FORWARD = 21;

/**
 * Estado central del portal.
 *
 * Junta lo que devuelve cada fuente en una sola colección por tipo de dato y
 * lleva aparte el estado de sincronización de cada una. Una fuente que falla no
 * tumba a las demas: se queda sin datos y su error se muestra en Ajustes, que
 * es justo lo que uno quiere de un tablero que junta cinco integraciones.
 */
@Injectable({ providedIn: 'root' })
export class PortalStore {
  private readonly config = inject(PORTAL_CONFIG);
  private readonly taskSources = inject(TASK_SOURCES);
  private readonly calendarSources = inject(CALENDAR_SOURCES);
  private readonly monitorSources = inject(MONITOR_SOURCES);
  private readonly crmSources = inject(CRM_SOURCES);
  private readonly licenseSources = inject(LICENSE_SOURCES);
  private readonly deploymentSources = inject(DEPLOYMENT_SOURCES);

  private readonly tasksSignal = signal<TaskItem[]>([]);
  private readonly meetingsSignal = signal<Meeting[]>([]);
  private readonly targetsSignal = signal<MonitorTarget[]>([]);
  private readonly opportunitiesSignal = signal<CrmOpportunity[]>([]);
  private readonly activitiesSignal = signal<CrmActivity[]>([]);
  private readonly licensesSignal = signal<LicenseUsage[]>([]);
  private readonly deploymentsSignal = signal<Deployment[]>([]);
  private readonly platformStatusSignal = signal<PlatformStatus[]>([]);
  private readonly syncSignal = signal<Record<string, SyncState>>({});
  private readonly lastRefreshSignal = signal<string | undefined>(undefined);

  readonly tasks = this.tasksSignal.asReadonly();
  readonly meetings = this.meetingsSignal.asReadonly();
  readonly targets = this.targetsSignal.asReadonly();
  readonly opportunities = this.opportunitiesSignal.asReadonly();
  readonly activities = this.activitiesSignal.asReadonly();
  readonly licenses = this.licensesSignal.asReadonly();
  readonly deployments = this.deploymentsSignal.asReadonly();
  readonly platformStatus = this.platformStatusSignal.asReadonly();
  readonly lastRefresh = this.lastRefreshSignal.asReadonly();

  readonly accounts: readonly Account[] = this.config.accounts;

  readonly syncStates = computed<SyncState[]>(() =>
    Object.values(this.syncSignal())
  );

  readonly loading = computed(() =>
    this.syncStates().some((state) => state.status === 'sincronizando')
  );

  readonly failedSources = computed(() =>
    this.syncStates().filter((state) => state.status === 'error')
  );

  /** True mientras al menos una fuente siga entregando datos inventados. */
  readonly hasDemoSources = computed(() =>
    this.syncStates().some((state) => state.demo)
  );

  private readonly accountIndex = computed(
    () => new Map(this.config.accounts.map((account) => [account.id, account]))
  );

  accountOf(accountId: string): Account | undefined {
    return this.accountIndex().get(accountId);
  }

  /** Vuelve a pedir todo. Es lo que corre al arrancar y en cada refresco. */
  refreshAll(): void {
    this.refreshTasks();
    this.refreshMeetings();
    this.refreshTargets();
    this.refreshCrm();
    this.refreshLicenses();
    this.refreshDeployments();
  }

  refreshTasks(): void {
    this.collect(this.taskSources, (source) => source.fetchTasks()).subscribe(
      (tasks) => this.tasksSignal.set(tasks)
    );
  }

  refreshMeetings(): void {
    const today = startOfDay(new Date());
    const range = {
      from: addDays(today, -CALENDAR_DAYS_BACK).toISOString(),
      to: addDays(today, CALENDAR_DAYS_FORWARD).toISOString()
    };
    this.collect(this.calendarSources, (source) =>
      source.fetchMeetings(range)
    ).subscribe((meetings) => this.meetingsSignal.set(meetings));
  }

  refreshTargets(): void {
    this.collect(this.monitorSources, (source) =>
      source.fetchTargets()
    ).subscribe((targets) => this.targetsSignal.set(targets));
  }

  refreshCrm(): void {
    this.collect(this.crmSources, (source) =>
      source.fetchOpportunities()
    ).subscribe((items) => this.opportunitiesSignal.set(items));
    // Las actividades comparten fuente con las oportunidades, así que su estado
    // de sincronización ya quedó marcado arriba; aquí solo se piden los datos.
    this.crmSources.forEach((source) => {
      source
        .fetchActivities()
        .pipe(catchError(() => of([] as CrmActivity[])))
        .subscribe((items) => this.activitiesSignal.set(items));
    });
  }

  refreshLicenses(): void {
    this.collect(this.licenseSources, (source) =>
      source.fetchLicenses()
    ).subscribe((licencias) => this.licensesSignal.set(licencias));
  }

  refreshDeployments(): void {
    this.collect(this.deploymentSources, (source) =>
      source.fetchDeployments()
    ).subscribe((despliegues) => this.deploymentsSignal.set(despliegues));
    // El estado de la plataforma comparte fuente con los despliegues, asi que
    // su sincronización ya quedó marcada arriba; aqui solo se piden los datos.
    this.deploymentSources.forEach((source) => {
      source
        .fetchPlatformStatus()
        .pipe(catchError(() => of([] as PlatformStatus[])))
        .subscribe((estados) => this.platformStatusSignal.set(estados));
    });
  }

  /**
   * Pide lo mismo a todas las fuentes de un tipo y junta las respuestas.
   *
   * Cada fuente lleva su propio `catchError` para que el falló de una no
   * cancele el `forkJoin` completo y deje la pantalla vacía.
   */
  private collect<S extends PortalSource, T>(
    sources: readonly S[],
    request: (source: S) => Observable<T[]>
  ): Observable<T[]> {
    if (sources.length === 0) {
      return of([]);
    }
    const calls = sources.map((source) => {
      this.markSync(source, 'sincronizando');
      return request(source).pipe(
        tap(() => this.markSync(source, 'lista')),
        catchError((error: unknown) => {
          this.markSync(source, 'error', describeError(error));
          return of([] as T[]);
        })
      );
    });
    return forkJoin(calls).pipe(
      map((results) => results.flat()),
      tap(() => this.lastRefreshSignal.set(new Date().toISOString()))
    );
  }

  private markSync(
    source: PortalSource,
    status: SyncState['status'],
    error?: string
  ): void {
    this.syncSignal.update((current) => ({
      ...current,
      [source.id]: {
        sourceId: source.id,
        label: source.label,
        kind: source.kind,
        status,
        lastSync:
          status === 'lista'
            ? new Date().toISOString()
            : current[source.id]?.lastSync,
        error,
        demo: source.demo
      }
    }));
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'No se pudo leer la fuente.';
}
