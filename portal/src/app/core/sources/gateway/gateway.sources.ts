import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CrmActivity,
  CrmOpportunity,
  Deployment,
  LicenseUsage,
  Meeting,
  MonitorTarget,
  PlatformStatus,
  SourceKind,
  TaskItem
} from '../../models';
import {
  CalendarSource,
  CrmSource,
  DateRange,
  DeploymentSource,
  LicenseSource,
  MonitorSource,
  TaskSource
} from '../source.contracts';

/**
 * Adaptadores contra el backend puente.
 *
 * El puente es un servicio propio que guarda las credenciales de Odoo, Google,
 * Microsoft y el monitoreo, y devuelve los modelos del portal ya traducidos.
 * El navegador nunca ve un token: por eso el puente existe, además de que ni
 * Odoo ni Google abren CORS para una aplicación de página única.
 *
 * Contrato que debe cumplir el puente, colgando de la ruta de cada conexión:
 *
 *   GET {base}{path}/tasks                  -> TaskItem[]
 *   GET {base}{path}/meetings?from=&to=     -> Meeting[]   (fechas en ISO)
 *   GET {base}{path}/targets                -> MonitorTarget[]
 *   GET {base}{path}/opportunities          -> CrmOpportunity[]
 *   GET {base}{path}/activities             -> CrmActivity[]
 *   GET {base}{path}/licenses               -> LicenseUsage[]
 *   GET {base}{path}/deployments            -> Deployment[]
 *   GET {base}{path}/platform-status        -> PlatformStatus[]
 *
 * La autenticación va por cookie de sesión del mismo origen, así que aquí no
 * se arma ningún encabezado con llaves.
 */
abstract class GatewaySource {
  readonly demo = false;

  protected constructor(
    readonly id: string,
    readonly label: string,
    readonly kind: SourceKind,
    protected readonly http: HttpClient,
    private readonly baseUrl: string,
    private readonly path: string
  ) {}

  protected endpoint(suffix: string): string {
    return `${this.baseUrl}${this.path}${suffix}`;
  }
}

export class GatewayTaskSource extends GatewaySource implements TaskSource {
  constructor(
    id: string,
    label: string,
    kind: SourceKind,
    http: HttpClient,
    baseUrl: string,
    path: string
  ) {
    super(id, label, kind, http, baseUrl, path);
  }

  fetchTasks(): Observable<TaskItem[]> {
    return this.http.get<TaskItem[]>(this.endpoint('/tasks'));
  }
}

export class GatewayCalendarSource
  extends GatewaySource
  implements CalendarSource
{
  constructor(
    id: string,
    label: string,
    kind: SourceKind,
    http: HttpClient,
    baseUrl: string,
    path: string
  ) {
    super(id, label, kind, http, baseUrl, path);
  }

  fetchMeetings(range: DateRange): Observable<Meeting[]> {
    return this.http.get<Meeting[]>(this.endpoint('/meetings'), {
      params: { from: range.from, to: range.to }
    });
  }
}

export class GatewayMonitorSource
  extends GatewaySource
  implements MonitorSource
{
  constructor(
    id: string,
    label: string,
    http: HttpClient,
    baseUrl: string,
    path: string
  ) {
    super(id, label, 'monitor', http, baseUrl, path);
  }

  fetchTargets(): Observable<MonitorTarget[]> {
    return this.http.get<MonitorTarget[]>(this.endpoint('/targets'));
  }
}

export class GatewayCrmSource extends GatewaySource implements CrmSource {
  constructor(
    id: string,
    label: string,
    http: HttpClient,
    baseUrl: string,
    path: string
  ) {
    super(id, label, 'odoo', http, baseUrl, path);
  }

  fetchOpportunities(): Observable<CrmOpportunity[]> {
    return this.http.get<CrmOpportunity[]>(this.endpoint('/opportunities'));
  }

  fetchActivities(): Observable<CrmActivity[]> {
    return this.http.get<CrmActivity[]>(this.endpoint('/activities'));
  }
}

export class GatewayLicenseSource
  extends GatewaySource
  implements LicenseSource
{
  constructor(
    id: string,
    label: string,
    kind: SourceKind,
    http: HttpClient,
    baseUrl: string,
    path: string
  ) {
    super(id, label, kind, http, baseUrl, path);
  }

  fetchLicenses(): Observable<LicenseUsage[]> {
    return this.http.get<LicenseUsage[]>(this.endpoint('/licenses'));
  }
}

export class GatewayDeploymentSource
  extends GatewaySource
  implements DeploymentSource
{
  constructor(
    id: string,
    label: string,
    http: HttpClient,
    baseUrl: string,
    path: string
  ) {
    super(id, label, 'vercel', http, baseUrl, path);
  }

  fetchDeployments(): Observable<Deployment[]> {
    return this.http.get<Deployment[]>(this.endpoint('/deployments'));
  }

  fetchPlatformStatus(): Observable<PlatformStatus[]> {
    return this.http.get<PlatformStatus[]>(this.endpoint('/platform-status'));
  }
}
