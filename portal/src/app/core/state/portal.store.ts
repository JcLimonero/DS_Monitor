import { mergeMeetings, unmirroredMeetings } from '../util/meetings.util';
import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Observable,
  catchError,
  combineLatest,
  finalize,
  interval,
  map,
  of,
  skip,
  startWith,
  tap,
  timeout
} from 'rxjs';
import { HttpClient } from '@angular/common/http';
import {
  LocalSettingsStore,
  applyLicenseSettings
} from '../config/local-settings.store';
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
  RepoStatus,
  SourceKind,
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
  REPO_SOURCES,
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
/** Cuánto se espera a una fuente antes de darla por caída en este refresco. */
const ESPERA_MAXIMA_MS = 90_000;

/** Cuanto se queda a la vista un pendiente recien marcado hecho. */
const RECIEN_HECHO_MS = 8_000;

@Injectable({ providedIn: 'root' })
export class PortalStore {
  private readonly config = inject(PORTAL_CONFIG);
  private readonly localSettings = inject(LocalSettingsStore);
  private readonly taskSources = inject(TASK_SOURCES);
  private readonly calendarSources = inject(CALENDAR_SOURCES);
  private readonly monitorSources = inject(MONITOR_SOURCES);
  private readonly crmSources = inject(CRM_SOURCES);
  private readonly licenseSources = inject(LICENSE_SOURCES);
  private readonly deploymentSources = inject(DEPLOYMENT_SOURCES);
  private readonly repoSources = inject(REPO_SOURCES);

  private readonly tasksSignal = signal<TaskItem[]>([]);
  /** Incluye personales: el diálogo de un aviso tiene que encontrarlos. */
  private readonly tasksTodasSignal = signal<TaskItem[]>([]);
  private readonly tareasListasSignal = signal(false);
  private readonly rawMeetingsSignal = signal<Meeting[]>([]);
  private readonly targetsSignal = signal<MonitorTarget[]>([]);
  private readonly opportunitiesSignal = signal<CrmOpportunity[]>([]);
  private readonly activitiesSignal = signal<CrmActivity[]>([]);
  private readonly licensesSignal = signal<LicenseUsage[]>([]);
  private readonly deploymentsSignal = signal<Deployment[]>([]);
  private readonly platformStatusSignal = signal<PlatformStatus[]>([]);
  private readonly reposSignal = signal<RepoStatus[]>([]);
  private readonly syncSignal = signal<Record<string, SyncState>>({});
  private readonly lastRefreshSignal = signal<string | undefined>(undefined);

  readonly tasks = this.tasksSignal.asReadonly();
  readonly tasksTodas = this.tasksTodasSignal.asReadonly();
  /** La primera lectura de pendientes ya contestó (aunque venga vacía). */
  readonly tareasListas = this.tareasListasSignal.asReadonly();
  /** Las juntas ya homologadas: la misma junta en dos cuentas sale una vez. */
  readonly meetings = computed(() => mergeMeetings(this.rawMeetingsSignal()));
  /** Cuentas que traen calendario, para saber dónde falta una junta. */
  readonly calendarAccounts = computed(() =>
    [...new Set(this.rawMeetingsSignal().map((m) => m.accountId))].sort()
  );
  /** Juntas que están en una cuenta y no en otra. */
  readonly unmirroredMeetings = computed(() =>
    unmirroredMeetings(this.meetings(), this.calendarAccounts())
  );
  readonly targets = this.targetsSignal.asReadonly();
  readonly opportunities = this.opportunitiesSignal.asReadonly();
  readonly activities = this.activitiesSignal.asReadonly();
  /** Lo que llegó de las fuentes, con las correcciones y altas de Ajustes. */
  readonly licenses = computed(() =>
    applyLicenseSettings(this.licensesSignal(), this.localSettings.settings())
  );
  /** Tal cual llegó de las fuentes, para que Ajustes muestre también lo oculto. */
  readonly fetchedLicenses = this.licensesSignal.asReadonly();
  readonly deployments = this.deploymentsSignal.asReadonly();
  readonly platformStatus = this.platformStatusSignal.asReadonly();
  readonly repos = this.reposSignal.asReadonly();
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

  /**
   * Peticiones abiertas por fuente. El estado de sincronización es uno solo
   * por fuente aunque pida varias cosas (correo: pendientes, agenda y
   * licencias). La primera que contesta lo deja en `lista` mientras las otras
   * siguen en camino; este conteo evita dar la fuente por contestada antes.
   */
  private readonly enVuelo = new Map<string, number>();
  private readonly enVueloVersion = signal(0);

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

  /**
   * True cuando hay al menos una fuente de ese kind y todas ya contestaron
   * (`lista` o `error`). Si alguna sigue `sincronizando`, todavía no aparece
   * o tiene una petición en curso, es false: un array vacío inicial no es
   * "no hay datos".
   */
  fuenteContestada(kind: SourceKind): boolean {
    this.enVueloVersion();
    const ids = this.idsDeKind(kind);
    if (ids.size === 0) {
      return false;
    }
    const porId = new Map(
      this.syncStates()
        .filter((estado) => ids.has(estado.sourceId))
        .map((estado) => [estado.sourceId, estado] as const)
    );
    if (porId.size < ids.size) {
      return false;
    }
    for (const id of ids) {
      if ((this.enVuelo.get(id) ?? 0) > 0) {
        return false;
      }
      const estado = porId.get(id);
      if (estado?.status !== 'lista' && estado?.status !== 'error') {
        return false;
      }
    }
    return true;
  }

  private idsDeKind(kind: SourceKind): Set<string> {
    const ids = new Set<string>();
    for (const fuente of [
      ...this.taskSources,
      ...this.calendarSources,
      ...this.monitorSources,
      ...this.crmSources,
      ...this.licenseSources,
      ...this.deploymentSources,
      ...this.repoSources
    ]) {
      if (fuente.kind === kind) {
        ids.add(fuente.id);
      }
    }
    return ids;
  }

  private anotarVuelo(sourceId: string, delta: number): void {
    const siguiente = (this.enVuelo.get(sourceId) ?? 0) + delta;
    if (siguiente <= 0) {
      this.enVuelo.delete(sourceId);
    } else {
      this.enVuelo.set(sourceId, siguiente);
    }
    this.enVueloVersion.update((version) => version + 1);
  }

  private readonly http = inject(HttpClient);

  /**
   * El puente se reinicia en cada publicación (un minuto, más o menos) y en
   * ese rato todo falla. Si hay fuentes con error, se le pregunta al puente
   * cada quince segundos si ya volvió y, en cuanto responde, se recarga todo
   * solo: nadie tiene que refrescar a mano ni pensar que se perdió algo.
   */
  readonly puenteCaido = signal(false);

  /**
   * Lo que se acaba de marcar hecho. Se queda unos segundos a la vista,
   * tachado y con "Reabrir", por si fue un error; después se esconde solo
   * (los hechos no se muestran salvo que se pida).
   */
  readonly recienHechos = signal<ReadonlySet<string>>(new Set());
  private readonly temporizadoresHecho = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  marcarRecienHecho(id: string, hecho: boolean): void {
    clearTimeout(this.temporizadoresHecho.get(id));
    this.temporizadoresHecho.delete(id);
    this.recienHechos.update((actual) => {
      const nuevo = new Set(actual);
      if (hecho) {
        nuevo.add(id);
      } else {
        nuevo.delete(id);
      }
      return nuevo;
    });
    if (hecho) {
      this.temporizadoresHecho.set(
        id,
        setTimeout(() => {
          this.temporizadoresHecho.delete(id);
          this.recienHechos.update((actual) => {
            const nuevo = new Set(actual);
            nuevo.delete(id);
            return nuevo;
          });
        }, RECIEN_HECHO_MS)
      );
    }
  }

  constructor() {
    if (this.config.gatewayUrl) {
      interval(15_000).subscribe(() => this.vigilarPuente());
    }
  }

  private vigilarPuente(): void {
    if (this.failedSources().length === 0 || this.loading()) {
      this.puenteCaido.set(false);
      return;
    }
    this.http.get(`${this.config.gatewayUrl}/salud`).subscribe({
      next: () => {
        const caido = this.puenteCaido();
        this.puenteCaido.set(false);
        // Si estaba caído y ya contesta, o si hay errores con el puente
        // sano (fue un reinicio a medias), se vuelve a pedir todo.
        if (caido || this.failedSources().length > 0) {
          this.refreshAll();
        }
      },
      error: () => this.puenteCaido.set(true)
    });
  }

  /** Vuelve a pedir todo. Es lo que corre al arrancar y en cada refresco. */
  refreshAll(): void {
    this.refreshTasks();
    this.refreshMeetings();
    this.refreshTargets();
    this.refreshCrm();
    this.refreshLicenses();
    this.refreshDeployments();
    this.refreshRepos();
  }

  refreshTasks(): void {
    // Lo personal no es del negocio: se queda en su módulo y no entra al
    // tablero, al carrusel ni a los resúmenes.
    this.collect(this.taskSources, (source) => source.fetchTasks()).subscribe(
      (tasks) => {
        this.tasksTodasSignal.set(tasks);
        this.tasksSignal.set(tasks.filter((task) => !task.personal));
        this.tareasListasSignal.set(true);
      }
    );
  }

  /**
   * Cambia un pendiente en memoria sin esperar al puente: para que lo que ya
   * se guardó (p. ej. la novedad vista) se refleje al instante.
   */
  actualizarTarea(id: string, cambio: Partial<TaskItem>): void {
    this.tasksSignal.update((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, ...cambio } : task))
    );
  }

  /**
   * Saca un pendiente de la lista en memoria al instante (p. ej. al borrar),
   * sin esperar a que el puente confirme y refresque.
   */
  quitarTarea(id: string): void {
    this.tasksSignal.update((tasks) => tasks.filter((task) => task.id !== id));
  }

  refreshMeetings(): void {
    const today = startOfDay(new Date());
    const range = {
      from: addDays(today, -CALENDAR_DAYS_BACK).toISOString(),
      to: addDays(today, CALENDAR_DAYS_FORWARD).toISOString()
    };
    this.collect(this.calendarSources, (source) =>
      source.fetchMeetings(range)
    ).subscribe((meetings) => this.rawMeetingsSignal.set(meetings));
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
      this.anotarVuelo(source.id, 1);
      source
        .fetchActivities()
        .pipe(
          catchError(() => of([] as CrmActivity[])),
          finalize(() => this.anotarVuelo(source.id, -1))
        )
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
      this.anotarVuelo(source.id, 1);
      source
        .fetchPlatformStatus()
        .pipe(
          catchError(() => of([] as PlatformStatus[])),
          finalize(() => this.anotarVuelo(source.id, -1))
        )
        .subscribe((estados) => this.platformStatusSignal.set(estados));
    });
  }

  refreshRepos(): void {
    this.collect(this.repoSources, (source) => source.fetchRepos()).subscribe(
      (repos) => this.reposSignal.set(repos)
    );
  }

  /** Lo último que entregó cada fuente, por tipo de dato y fuente. */
  private readonly previos = new Map<string, unknown[]>();

  /**
   * Pide lo mismo a todas las fuentes de un tipo y junta las respuestas.
   *
   * Emite conforme va contestando cada fuente, no hasta que contesten
   * todas: un buzón que tarda minutos (el puente recién arrancado leyendo
   * miles de correos) no puede dejar el tablero vacío mientras tanto. Lo que
   * todavía no contesta se rellena con lo último que entregó, y cada fuente
   * lleva su propio `catchError` y un tope de espera para que ninguna se
   * quede "sincronizando" para siempre.
   */
  private collect<S extends PortalSource, T>(
    sources: readonly S[],
    request: (source: S) => Observable<T[]>
  ): Observable<T[]> {
    if (sources.length === 0) {
      return of([]);
    }
    const clave = (source: S) => `${source.kind}:${source.id}`;
    const calls = sources.map((source) => {
      this.anotarVuelo(source.id, 1);
      this.markSync(source, 'sincronizando');
      return request(source).pipe(
        timeout(ESPERA_MAXIMA_MS),
        tap((items) => {
          this.previos.set(clave(source), items);
          this.markSync(source, 'lista');
        }),
        catchError((error: unknown) => {
          this.markSync(source, 'error', describeError(error));
          return of((this.previos.get(clave(source)) ?? []) as T[]);
        }),
        finalize(() => this.anotarVuelo(source.id, -1)),
        startWith((this.previos.get(clave(source)) ?? []) as T[])
      );
    });
    return combineLatest(calls).pipe(
      skip(1),
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
