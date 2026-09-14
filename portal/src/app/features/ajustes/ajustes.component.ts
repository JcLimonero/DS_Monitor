import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import {
  ConnectionMode,
  SourceConnection
} from '../../core/config/portal-config.model';
import { Account, SourceKind, SyncState } from '../../core/models';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { RelativePipe } from '../../ui/portal.pipes';

const KIND_LABEL: Record<SourceKind, string> = {
  odoo: 'Odoo',
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
  ops: 'Ops',
  local: 'Portal',
  monitor: 'Monitoreo',
  anthropic: 'Claude',
  cursor: 'Cursor',
  figma: 'Figma',
  vercel: 'Vercel',
  github: 'GitHub'
};

const CAPABILITY_LABEL: Record<SourceConnection['provides'][number], string> = {
  tasks: 'Pendientes',
  meetings: 'Juntas',
  monitors: 'Monitoreo',
  crm: 'CRM',
  licenses: 'Licencias',
  deployments: 'Despliegues',
  repos: 'Repositorios'
};

/** Qué hace falta del lado del puente para que la conexión deje de ser demo. */
const REQUIREMENTS: Record<SourceKind, string> = {
  odoo:
    'Usuario de Odoo con permiso de lectura sobre crm.lead y mail.activity, más la URL de la ' +
    'instancia y la base de datos. El puente se autentica por JSON-RPC.',
  google:
    'Cliente OAuth de Google con el permiso calendar.readonly y el consentimiento de la cuenta ' +
    'cuyo calendario se va a leer.',
  microsoft:
    'Registro de aplicación en Entra ID con el permiso Calendars.Read y el consentimiento de la ' +
    'cuenta correspondiente.',
  ops: 'Credencial de lectura del tablero de Ops y el identificador del equipo de desarrollo.',
  monitor:
    'La lista de destinos a vigilar. El puente hace las revisiones: desde el navegador no se ' +
    'puede por CORS, y además cada quien mediría su propia red.',
  local: 'Nada: estos pendientes se capturan y se guardan en el navegador.',
  anthropic:
    'Una Admin API key de la organización (sk-ant-admin...). El puente consulta ' +
    '/v1/organizations/usage_report/messages para los tokens y /v1/organizations/cost_report ' +
    'para el gasto; esos dos no están en los SDK, van por HTTP crudo. Los datos tardan hasta ' +
    'cinco minutos en aparecer y no conviene sondear más de una vez por minuto.',
  cursor:
    'Una Team API key con permiso admin o usage. El puente consulta /teams/members, ' +
    '/teams/daily-usage-data y /teams/spend en api.cursor.com. El límite es de veinte ' +
    'peticiones por minuto por equipo.',
  figma:
    'Un token con acceso a la organización. Ojo: Figma NO publica facturación ni asientos ' +
    'contratados por API. Se puede contar quién ocupa asiento con /v1/teams/{id}/members y, ' +
    'en Enterprise, quién estuvo activo con /v1/activity_logs; el tope contratado y el costo ' +
    'hay que capturarlos a mano.',
  vercel:
    'Un access token con acceso al equipo. El puente consulta /v6/deployments para los ' +
    'despliegues y la página pública de estado de Vercel para los incidentes de la plataforma.',
  github:
    'Un token con lectura sobre los repositorios: permiso "repo" en uno clásico, o ' +
    'contents:read, pull_requests:read y checks:read en uno de grano fino. También se puede ' +
    'mandar el estado desde tu propio CI con POST /ingesta/repos, y así el puente no necesita ' +
    'token de GitHub. Ver puente/INGESTA.md.'
};

const MODE_LABEL: Record<ConnectionMode, string> = {
  demo: 'Demostración',
  gateway: 'A través del puente',
  local: 'Solo en este navegador'
};

interface ConnectionRow {
  connection: SourceConnection;
  account?: Account;
  sync?: SyncState;
  kindLabel: string;
  modeLabel: string;
  capabilities: string[];
  requirement: string;
}

@Component({
  selector: 'pt-ajustes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PageHeaderComponent, RelativePipe],
  templateUrl: './ajustes.component.html'
})
export class AjustesComponent {
  private readonly store = inject(PortalStore);

  readonly config = inject(PORTAL_CONFIG);

  readonly rows = computed<ConnectionRow[]>(() => {
    const syncById = new Map(
      this.store.syncStates().map((state) => [state.sourceId, state])
    );
    return this.config.connections.map((connection) => ({
      connection,
      account: this.store.accountOf(connection.accountId),
      sync: syncById.get(connection.id),
      kindLabel: KIND_LABEL[connection.kind],
      modeLabel: MODE_LABEL[connection.mode],
      capabilities: connection.provides.map(
        (capability) => CAPABILITY_LABEL[capability]
      ),
      requirement: REQUIREMENTS[connection.kind]
    }));
  });

  readonly demoCount = computed(
    () => this.rows().filter((row) => row.sync?.demo).length
  );
  readonly errorCount = computed(
    () => this.rows().filter((row) => row.sync?.status === 'error').length
  );

  readonly subtitle = computed(() =>
    [
      plural(this.rows().length, 'conexión', 'conexiones'),
      `${this.demoCount()} en demostración`,
      `${this.errorCount()} con error`
    ].join(' · ')
  );

  readonly gatewayLabel = computed(() =>
    this.config.gatewayUrl ? this.config.gatewayUrl : 'sin configurar'
  );

  statusClass(status: SyncState['status'] | undefined): string {
    switch (status) {
      case 'lista':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
      case 'error':
        return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
      case 'sincronizando':
        return 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300';
      default:
        return 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300';
    }
  }

  statusLabel(status: SyncState['status'] | undefined): string {
    switch (status) {
      case 'lista':
        return 'Lista';
      case 'error':
        return 'Error';
      case 'sincronizando':
        return 'Sincronizando';
      default:
        return 'Inactiva';
    }
  }

  refresh(): void {
    this.store.refreshAll();
  }
}
