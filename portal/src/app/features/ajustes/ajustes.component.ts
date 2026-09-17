import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  gatewayOverride,
  setGatewayOverride
} from '../../core/config/gateway-override';
import {
  ACCOUNT_COLORS,
  LicenseEdit,
  correoCuentasLine,
  isMailKind
} from '../../core/config/local-settings';
import {
  LocalSettingsStore,
  NewManualLicense
} from '../../core/config/local-settings.store';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import {
  ConnectionMode,
  SourceConnection
} from '../../core/config/portal-config.model';
import {
  Account,
  AccountColor,
  LICENSE_PROVIDER_LABEL,
  LicenseProvider,
  LicenseUsage,
  Person,
  SourceKind,
  SyncState
} from '../../core/models';
import {
  CredencialesBuzon,
  Dominio,
  EstadoBuzon,
  EstadoIntegracion,
  PuenteAdminService,
  ResultadoPrueba
} from '../../core/sources/gateway/puente-admin.service';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';

const KIND_LABEL: Record<SourceKind, string> = {
  odoo: 'Odoo',
  google: 'Gmail',
  microsoft: 'Microsoft 365',
  imap: 'Correo IMAP',
  dominios: 'Dominios',
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
    'Una contraseña de aplicación de la cuenta de Google (Seguridad → Verificación en dos pasos → ' +
    'Contraseñas de aplicaciones) en CORREO_CONTRASENA_<ID> del puente. El puente entra por IMAP a ' +
    'imap.gmail.com, lee las invitaciones con archivo de calendario, los correos que piden una ' +
    'acción y los recibos de suscripciones.',
  microsoft:
    'Microsoft ya no acepta IMAP con contraseña, ni en Microsoft 365 ni en Outlook.com. Hace falta ' +
    'un registro de aplicación en Entra ID con Mail.Read y Calendars.Read; ese adaptador todavía no ' +
    'está construido en el puente. Mientras tanto el buzón lo alimenta el barrido de Mail.app en la ' +
    'Mac (npm run barrido en puente/), que manda licencias y pendientes por ingesta con un emisor ' +
    'del mismo nombre en INGESTA_CLIENTES. Las juntas necesitan el adaptador OAuth.',
  imap:
    'Servidor, usuario y contraseña del buzón en CORREO_CUENTAS y CORREO_CONTRASENA_<ID> del ' +
    'puente. Neubox acepta la contraseña del buzón; iCloud pide una contraseña específica de ' +
    'aplicación (appleid.apple.com → Iniciar sesión y seguridad).',
  ops: 'Credencial de lectura del tablero de Ops y el identificador del equipo de desarrollo.',
  dominios:
    'Nada que conectar: los dominios se capturan en la pestaña Dominios y el puente los guarda.',
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

/** Las pestañas de Ajustes, por tema. */
export type SettingsTab =
  'correo' | 'licencias' | 'dominios' | 'equipo' | 'integraciones' | 'puente';

export const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'correo', label: 'Correo' },
  { id: 'licencias', label: 'Licencias' },
  { id: 'dominios', label: 'Dominios' },
  { id: 'equipo', label: 'Equipo' },
  { id: 'integraciones', label: 'Integraciones' },
  { id: 'puente', label: 'Puente' }
];

const TAB_KEY = 'ds-monitor.ajustes.tab';

interface ConnectionRow {
  connection: SourceConnection;
  account?: Account;
  sync?: SyncState;
  kindLabel: string;
  modeLabel: string;
  capabilities: string[];
  requirement: string;
  enabled: boolean;
  /** True si la cuenta se agregó desde Ajustes y se puede quitar. */
  added: boolean;
  /** Línea para CORREO_CUENTAS del puente, solo en buzones agregados. */
  puenteLine?: string;
}

/** Lo que Ajustes sabe de la conexión de un buzón, según el puente. */
type ConexionBuzon =
  { estado: EstadoBuzon } | { error: string } | { cargando: true };

const METODO_LABEL: Record<EstadoBuzon['metodo'], string> = {
  graph: 'Conectada por Microsoft Graph',
  imap: 'IMAP con contraseña',
  envio: 'Alimentada por el barrido de Mail.app',
  ninguno: 'Sin conexión'
};

interface LicenseRow {
  license: LicenseUsage;
  account?: Account;
  edit?: LicenseEdit;
  hidden: boolean;
}

/** Borrador de la edición de una licencia; todo en texto por el formulario. */
interface LicenseDraft {
  cost: string;
  currency: string;
  plan: string;
  renewsAt: string;
}

@Component({
  selector: 'pt-ajustes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    DayPipe,
    DecimalPipe,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    RelativePipe
  ],
  templateUrl: './ajustes.component.html'
})
export class AjustesComponent {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalSettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly admin = inject(PuenteAdminService);

  readonly config = inject(PORTAL_CONFIG);
  readonly tabs = TABS;
  readonly providerLabel = LICENSE_PROVIDER_LABEL;
  readonly providers: LicenseProvider[] = [
    'otro',
    'anthropic',
    'cursor',
    'figma',
    'vercel'
  ];
  readonly colors = ACCOUNT_COLORS;
  readonly mailKinds: { kind: SourceKind; label: string }[] = [
    { kind: 'google', label: 'Gmail' },
    { kind: 'microsoft', label: 'Microsoft 365 / Outlook' },
    { kind: 'imap', label: 'IMAP (Neubox, iCloud, otro)' }
  ];

  readonly tab = signal<SettingsTab>(readTab());

  // --- Conexiones ---

  readonly rows = computed<ConnectionRow[]>(() => {
    const syncById = new Map(
      this.store.syncStates().map((state) => [state.sourceId, state])
    );
    return this.config.connections.map((connection) => {
      const account = this.store.accountOf(connection.accountId);
      const added = this.local.isAdded(connection.accountId);
      return {
        connection,
        account,
        sync: syncById.get(connection.id),
        kindLabel: KIND_LABEL[connection.kind],
        modeLabel: MODE_LABEL[connection.mode],
        capabilities: connection.provides.map(
          (capability) => CAPABILITY_LABEL[capability]
        ),
        requirement: REQUIREMENTS[connection.kind],
        enabled: account?.enabled ?? true,
        added,
        puenteLine:
          added && account && isMailKind(account.kind)
            ? correoCuentasLine(account)
            : undefined
      };
    });
  });

  readonly mailRows = computed(() =>
    this.rows().filter((row) => isMailKind(row.connection.kind))
  );
  readonly otherRows = computed(() =>
    this.rows().filter((row) => !isMailKind(row.connection.kind))
  );

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

  /** Se necesita recargar para que los cambios de cuentas tomen efecto. */
  readonly needsReload = signal(false);

  setAccountEnabled(accountId: string, enabled: boolean): void {
    this.local.setAccountEnabled(accountId, enabled);
    this.needsReload.set(true);
  }

  removeAccount(accountId: string): void {
    this.local.removeAccount(accountId);
    this.needsReload.set(true);
  }

  /** Demostración o datos reales del puente, por conexión. Requiere recargar. */
  setConnectionMode(row: ConnectionRow, gateway: boolean): void {
    this.local.setConnectionMode(
      row.connection.id,
      gateway ? 'gateway' : 'demo'
    );
    this.needsReload.set(true);
  }

  reload(): void {
    location.reload();
  }

  // --- Conexión de cada buzón, según el puente ---

  readonly conexiones = signal<Record<string, ConexionBuzon>>({});
  readonly conexionEditando = signal<string | undefined>(undefined);
  readonly credDraft = signal<CredencialesBuzon>({});
  readonly pruebas = signal<Record<string, ResultadoPrueba>>({});
  readonly ocupado = signal<string | undefined>(undefined);
  readonly metodoLabel = METODO_LABEL;

  /** Aviso al volver del consentimiento de Microsoft. */
  readonly oauthNotice = signal<
    { ok: boolean; correo: string; mensaje: string } | undefined
  >(undefined);

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    const correo = params.get('correo');
    const oauth = params.get('oauth');
    if (correo && oauth) {
      this.oauthNotice.set({
        ok: oauth === 'ok',
        correo,
        mensaje: params.get('mensaje') ?? ''
      });
      this.selectTab('correo');
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
    if (this.admin.disponible) {
      this.loadConnections();
      this.loadIntegraciones();
      this.loadEquipo();
      this.loadDominios();
    }
  }

  loadConnections(): void {
    for (const row of this.mailRows()) {
      this.loadConnection(row.connection.accountId);
    }
  }

  private loadConnection(id: string): void {
    this.conexiones.update((c) => ({ ...c, [id]: { cargando: true } }));
    this.admin.estado(id).subscribe({
      next: (estado) =>
        this.conexiones.update((c) => ({ ...c, [id]: { estado } })),
      error: (error: unknown) =>
        this.conexiones.update((c) => ({
          ...c,
          [id]: { error: describeHttp(error) }
        }))
    });
  }

  conexionDe(id: string): ConexionBuzon | undefined {
    return this.conexiones()[id];
  }

  estadoDe(id: string): EstadoBuzon | undefined {
    const conexion = this.conexiones()[id];
    return conexion && 'estado' in conexion ? conexion.estado : undefined;
  }

  startConnectionEdit(row: ConnectionRow): void {
    const estado = this.estadoDe(row.connection.accountId);
    const email = row.account?.detail.split(' ')[0] ?? '';
    this.credDraft.set({
      proveedor: row.connection.kind,
      usuario: estado?.usuario ?? email,
      host: estado?.host ?? '',
      puerto: estado?.puerto ?? 993,
      contrasena: '',
      tenant: estado?.tenant ?? 'common',
      clientId: estado?.clientId ?? '',
      clientSecret: ''
    });
    this.conexionEditando.set(row.connection.accountId);
  }

  cancelConnectionEdit(): void {
    this.conexionEditando.set(undefined);
  }

  updateCred(patch: Partial<CredencialesBuzon>): void {
    this.credDraft.update((current) => ({ ...current, ...patch }));
  }

  saveConnection(row: ConnectionRow): void {
    const id = row.connection.accountId;
    const draft = this.credDraft();
    this.ocupado.set(id);
    this.admin
      .guardar(id, {
        ...draft,
        puerto: Number(draft.puerto) || undefined
      })
      .subscribe({
        next: (estado) => {
          this.conexiones.update((c) => ({ ...c, [id]: { estado } }));
          this.pruebas.update((p) => ({
            ...p,
            [id]: { ok: true, mensaje: 'Guardado en el puente.' }
          }));
          this.conexionEditando.set(undefined);
          this.ocupado.set(undefined);
        },
        error: (error: unknown) => {
          this.pruebas.update((p) => ({
            ...p,
            [id]: { ok: false, mensaje: describeHttp(error) }
          }));
          this.ocupado.set(undefined);
        }
      });
  }

  testConnection(row: ConnectionRow): void {
    const id = row.connection.accountId;
    this.ocupado.set(id);
    this.admin.probar(id).subscribe({
      next: (resultado) => {
        this.pruebas.update((p) => ({ ...p, [id]: resultado }));
        this.ocupado.set(undefined);
        if (resultado.ok) {
          this.store.refreshAll();
        }
      },
      error: (error: unknown) => {
        this.pruebas.update((p) => ({
          ...p,
          [id]: { ok: false, mensaje: describeHttp(error) }
        }));
        this.ocupado.set(undefined);
      }
    });
  }

  connectMicrosoft(row: ConnectionRow): void {
    const id = row.connection.accountId;
    this.ocupado.set(id);
    const volver = `${location.origin}/ajustes`;
    this.admin.iniciarOauth(id, volver).subscribe({
      next: ({ url }) => {
        location.assign(url);
      },
      error: (error: unknown) => {
        this.pruebas.update((p) => ({
          ...p,
          [id]: { ok: false, mensaje: describeHttp(error) }
        }));
        this.ocupado.set(undefined);
      }
    });
  }

  // --- Integraciones (GitHub, Claude, Odoo...) según el puente ---

  readonly integraciones = signal<EstadoIntegracion[] | undefined>(undefined);
  readonly integracionesError = signal<string | undefined>(undefined);
  readonly integracionEditando = signal<string | undefined>(undefined);
  readonly variablesDraft = signal<Record<string, string>>({});
  readonly pruebasIntegracion = signal<Record<string, ResultadoPrueba>>({});

  loadIntegraciones(): void {
    if (!this.admin.disponible) {
      return;
    }
    this.admin.integraciones().subscribe({
      next: (lista) => {
        this.integraciones.set(lista);
        this.integracionesError.set(undefined);
      },
      error: (error: unknown) =>
        this.integracionesError.set(describeHttp(error))
    });
  }

  /** La integración del puente que corresponde a una conexión del portal. */
  integracionDe(row: ConnectionRow): EstadoIntegracion | undefined {
    return this.integraciones()?.find((i) => i.kind === row.connection.kind);
  }

  startIntegracionEdit(estado: EstadoIntegracion): void {
    const draft: Record<string, string> = {};
    for (const campo of estado.campos) {
      draft[campo.variable] =
        campo.tipo === 'largo'
          ? (campo.valor ?? '').split(';').join('\n')
          : (campo.valor ?? '');
    }
    this.variablesDraft.set(draft);
    this.integracionEditando.set(estado.id);
  }

  cancelIntegracionEdit(): void {
    this.integracionEditando.set(undefined);
  }

  updateVariable(variable: string, valor: string): void {
    this.variablesDraft.update((current) => ({
      ...current,
      [variable]: valor
    }));
  }

  saveIntegracion(estado: EstadoIntegracion): void {
    const draft = this.variablesDraft();
    // Un secreto vacío es "no lo cambies", no "bórralo": para borrarlo se
    // escribe un espacio. Lo demás vacío sí se borra.
    const variables: Record<string, string> = {};
    for (const campo of estado.campos) {
      const valor = draft[campo.variable] ?? '';
      if (campo.tipo === 'secreto' && valor === '') {
        continue;
      }
      variables[campo.variable] = valor;
    }
    this.ocupado.set(estado.id);
    this.admin.guardarIntegracion(estado.id, variables).subscribe({
      next: (nuevo) => {
        this.integraciones.update((lista) =>
          (lista ?? []).map((i) => (i.id === nuevo.id ? nuevo : i))
        );
        this.pruebasIntegracion.update((p) => ({
          ...p,
          [estado.id]: { ok: true, mensaje: 'Guardado en el puente.' }
        }));
        this.integracionEditando.set(undefined);
        this.ocupado.set(undefined);
        // Ya configurada en el puente: las conexiones de esa integración pasan
        // a datos reales, que es para lo que se capturó la credencial.
        if (nuevo.configurada) {
          for (const row of this.otherRows()) {
            if (
              row.connection.kind === nuevo.kind &&
              row.connection.mode !== 'gateway'
            ) {
              this.local.setConnectionMode(row.connection.id, 'gateway');
              this.needsReload.set(true);
            }
          }
        }
        this.store.refreshAll();
      },
      error: (error: unknown) => {
        this.pruebasIntegracion.update((p) => ({
          ...p,
          [estado.id]: { ok: false, mensaje: describeHttp(error) }
        }));
        this.ocupado.set(undefined);
      }
    });
  }

  testIntegracion(estado: EstadoIntegracion): void {
    this.ocupado.set(estado.id);
    this.admin.probarIntegracion(estado.id).subscribe({
      next: (resultado) => {
        this.pruebasIntegracion.update((p) => ({
          ...p,
          [estado.id]: resultado
        }));
        this.ocupado.set(undefined);
      },
      error: (error: unknown) => {
        this.pruebasIntegracion.update((p) => ({
          ...p,
          [estado.id]: { ok: false, mensaje: describeHttp(error) }
        }));
        this.ocupado.set(undefined);
      }
    });
  }

  /** Integraciones del puente que no corresponden a ninguna conexión (Acceso). */
  readonly integracionesSueltas = computed(() => {
    const kinds = new Set(
      this.otherRows().map((row) => row.connection.kind as string)
    );
    return (this.integraciones() ?? []).filter((i) => !kinds.has(i.kind));
  });

  // --- Equipo ---

  readonly equipo = signal<Person[] | undefined>(undefined);
  readonly equipoDraft = signal<Person[]>([]);
  readonly equipoMensaje = signal<ResultadoPrueba | undefined>(undefined);
  readonly nuevaPersona = signal<Person>({
    id: '',
    name: '',
    email: '',
    role: ''
  });

  loadEquipo(): void {
    if (!this.admin.disponible) {
      return;
    }
    this.admin.equipo().subscribe({
      next: (personas) => {
        this.equipo.set(personas);
        this.equipoDraft.set(personas.map((p) => ({ ...p })));
      },
      error: (error: unknown) =>
        this.equipoMensaje.set({ ok: false, mensaje: describeHttp(error) })
    });
  }

  updatePersona(index: number, patch: Partial<Person>): void {
    this.equipoDraft.update((lista) =>
      lista.map((p, i) => (i === index ? { ...p, ...patch } : p))
    );
  }

  removePersona(index: number): void {
    this.equipoDraft.update((lista) => lista.filter((_, i) => i !== index));
  }

  addPersona(): void {
    const nueva = this.nuevaPersona();
    if (!nueva.name.trim()) {
      return;
    }
    this.equipoDraft.update((lista) => [
      ...lista,
      { ...nueva, id: nueva.email?.trim() || nueva.name.trim().toLowerCase() }
    ]);
    this.nuevaPersona.set({ id: '', name: '', email: '', role: '' });
  }

  updateNuevaPersona(patch: Partial<Person>): void {
    this.nuevaPersona.update((p) => ({ ...p, ...patch }));
  }

  saveEquipo(): void {
    this.ocupado.set('equipo');
    this.admin.guardarEquipo(this.equipoDraft()).subscribe({
      next: (personas) => {
        this.equipo.set(personas);
        this.equipoDraft.set(personas.map((p) => ({ ...p })));
        this.equipoMensaje.set({
          ok: true,
          mensaje: 'Equipo guardado en el puente.'
        });
        this.ocupado.set(undefined);
      },
      error: (error: unknown) => {
        this.equipoMensaje.set({ ok: false, mensaje: describeHttp(error) });
        this.ocupado.set(undefined);
      }
    });
  }

  // --- Dominios ---

  readonly dominios = signal<Dominio[] | undefined>(undefined);
  readonly dominiosDraft = signal<Dominio[]>([]);
  readonly dominiosMensaje = signal<ResultadoPrueba | undefined>(undefined);
  readonly nuevoDominio = signal<Dominio>({
    nombre: '',
    registrador: 'Neubox',
    venceEn: '',
    costo: undefined,
    moneda: 'MXN',
    automatico: false
  });

  loadDominios(): void {
    if (!this.admin.disponible) {
      return;
    }
    this.admin.dominios().subscribe({
      next: (lista) => {
        this.dominios.set(lista);
        this.dominiosDraft.set(lista.map((d) => ({ ...d })));
      },
      error: (error: unknown) =>
        this.dominiosMensaje.set({ ok: false, mensaje: describeHttp(error) })
    });
  }

  diasPara(venceEn: string): number {
    return Math.ceil((Date.parse(venceEn) - Date.now()) / 86_400_000);
  }

  fechaCorta(iso: string): string {
    return iso ? iso.slice(0, 10) : '';
  }

  updateDominio(index: number, patch: Partial<Dominio>): void {
    this.dominiosDraft.update((lista) =>
      lista.map((d, i) => (i === index ? { ...d, ...patch } : d))
    );
  }

  removeDominio(index: number): void {
    this.dominiosDraft.update((lista) => lista.filter((_, i) => i !== index));
  }

  addDominio(): void {
    const nuevo = this.nuevoDominio();
    if (!nuevo.nombre.trim() || !nuevo.venceEn) {
      return;
    }
    this.dominiosDraft.update((lista) => [...lista, { ...nuevo }]);
    this.nuevoDominio.update((d) => ({
      ...d,
      nombre: '',
      venceEn: '',
      costo: undefined,
      notas: ''
    }));
  }

  updateNuevoDominio(patch: Partial<Dominio>): void {
    this.nuevoDominio.update((d) => ({ ...d, ...patch }));
  }

  saveDominios(): void {
    this.ocupado.set('dominios');
    const lista = this.dominiosDraft().map((d) => ({
      ...d,
      venceEn:
        d.venceEn.length === 10 ? `${d.venceEn}T12:00:00.000Z` : d.venceEn,
      costo:
        d.costo === undefined || d.costo === null || String(d.costo) === ''
          ? undefined
          : Number(d.costo)
    }));
    this.admin.guardarDominios(lista).subscribe({
      next: (guardados) => {
        this.dominios.set(guardados);
        this.dominiosDraft.set(guardados.map((d) => ({ ...d })));
        this.dominiosMensaje.set({
          ok: true,
          mensaje: 'Dominios guardados en el puente.'
        });
        this.ocupado.set(undefined);
        this.store.refreshLicenses();
      },
      error: (error: unknown) => {
        this.dominiosMensaje.set({ ok: false, mensaje: describeHttp(error) });
        this.ocupado.set(undefined);
      }
    });
  }

  // --- Token de administración ---

  readonly tokenInput = signal(this.admin.token());

  saveToken(): void {
    this.admin.setToken(this.tokenInput());
    if (this.admin.disponible) {
      this.loadConnections();
      this.loadIntegraciones();
    }
  }

  // --- Alta de buzón ---

  readonly newMailLabel = signal('');
  readonly newMailEmail = signal('');
  readonly newMailKind = signal<SourceKind>('imap');
  readonly newMailColor = signal<AccountColor>('sky');

  readonly canAddMail = computed(
    () =>
      this.newMailLabel().trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.newMailEmail().trim())
  );

  addMail(): void {
    if (!this.canAddMail()) {
      return;
    }
    this.local.addMailAccount(
      {
        label: this.newMailLabel(),
        email: this.newMailEmail(),
        kind: this.newMailKind(),
        color: this.newMailColor()
      },
      new Set(this.config.accounts.map((account) => account.id))
    );
    this.newMailLabel.set('');
    this.newMailEmail.set('');
    this.needsReload.set(true);
  }

  // --- Licencias ---

  readonly licenseRows = computed<LicenseRow[]>(() => {
    const edits = this.local.licenseEdits();
    return this.store.fetchedLicenses().map((license) => ({
      license,
      account: this.store.accountOf(license.accountId),
      edit: edits[license.id],
      hidden: edits[license.id]?.hidden === true
    }));
  });

  readonly manualLicenses = computed(() =>
    this.local.manualLicenses().map((license) => ({
      license,
      account: this.store.accountOf(license.accountId)
    }))
  );

  /** Cuentas a las que se puede colgar una licencia capturada a mano. */
  readonly licenseAccounts = computed(() =>
    this.config.accounts.filter((account) => account.enabled)
  );

  readonly editing = signal<string | undefined>(undefined);
  readonly draft = signal<LicenseDraft>({
    cost: '',
    currency: '',
    plan: '',
    renewsAt: ''
  });

  startEdit(row: LicenseRow): void {
    const shown = { ...row.license, ...row.edit };
    this.draft.set({
      cost: shown.cost !== undefined ? String(shown.cost) : '',
      currency: shown.currency ?? 'MXN',
      plan: shown.plan ?? '',
      renewsAt: shown.renewsAt ? shown.renewsAt.slice(0, 10) : ''
    });
    this.editing.set(row.license.id);
  }

  cancelEdit(): void {
    this.editing.set(undefined);
  }

  saveEdit(row: LicenseRow): void {
    const draft = this.draft();
    // El input numérico entrega un número con ngModel, no texto.
    const costText = String(draft.cost ?? '').trim();
    const cost = costText === '' ? undefined : Number(costText);
    this.local.editLicense(row.license.id, {
      cost: cost !== undefined && Number.isFinite(cost) ? cost : undefined,
      currency:
        cost !== undefined ? draft.currency.trim().toUpperCase() : undefined,
      plan:
        draft.plan.trim() !== row.license.plan ? draft.plan.trim() : undefined,
      renewsAt:
        draft.renewsAt && draft.renewsAt !== row.license.renewsAt?.slice(0, 10)
          ? new Date(`${draft.renewsAt}T12:00:00`).toISOString()
          : undefined,
      hidden: row.hidden
    });
    this.editing.set(undefined);
  }

  setHidden(row: LicenseRow, hidden: boolean): void {
    this.local.editLicense(row.license.id, { ...row.edit, hidden });
  }

  clearEdit(row: LicenseRow): void {
    this.local.clearLicenseEdit(row.license.id);
  }

  updateDraft(patch: Partial<LicenseDraft>): void {
    this.draft.update((current) => ({ ...current, ...patch }));
  }

  // --- Alta de licencia a mano ---

  readonly newLicense = signal<NewManualLicense>({
    product: '',
    provider: 'otro',
    accountId: '',
    plan: '',
    cost: undefined,
    currency: 'MXN',
    period: 'mensual',
    renewsAt: '',
    url: ''
  });
  readonly newLicenseCost = signal('');

  readonly canAddLicense = computed(
    () =>
      this.newLicense().product.trim().length > 0 &&
      this.newLicense().accountId.length > 0
  );

  updateNewLicense(patch: Partial<NewManualLicense>): void {
    this.newLicense.update((current) => ({ ...current, ...patch }));
  }

  addLicense(): void {
    if (!this.canAddLicense()) {
      return;
    }
    const costText = String(this.newLicenseCost() ?? '').trim();
    const cost = Number(costText);
    const input = this.newLicense();
    this.local.addManualLicense({
      ...input,
      cost: costText !== '' && Number.isFinite(cost) ? cost : undefined,
      renewsAt: input.renewsAt
        ? new Date(`${input.renewsAt}T12:00:00`).toISOString()
        : undefined
    });
    this.newLicense.update((current) => ({
      ...current,
      product: '',
      plan: '',
      renewsAt: '',
      url: ''
    }));
    this.newLicenseCost.set('');
  }

  removeManualLicense(id: string): void {
    this.local.removeManualLicense(id);
  }

  // --- Puente ---

  readonly gatewayLabel = computed(() =>
    this.config.gatewayUrl ? this.config.gatewayUrl : 'sin configurar'
  );

  /** Raíz guardada en este navegador, si se eligió una distinta a la del entorno. */
  readonly gatewayOverride = signal(gatewayOverride());
  readonly gatewayInput = signal(gatewayOverride() ?? '');

  useGateway(): void {
    setGatewayOverride(this.gatewayInput().trim() || undefined);
    location.reload();
  }

  resetGateway(): void {
    setGatewayOverride(undefined);
    location.reload();
  }

  // --- Utilería de la vista ---

  selectTab(tab: SettingsTab): void {
    this.tab.set(tab);
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Sin almacenamiento la pestaña simplemente no se recuerda.
    }
  }

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

/** El mensaje de un error HTTP tal como lo mandó el puente, si se puede. */
function describeHttp(error: unknown): string {
  const http = error as {
    status?: number;
    error?: { error?: string } | string;
    message?: string;
  };
  if (http && typeof http.error === 'object' && http.error?.error) {
    return http.error.error;
  }
  if (http?.status === 0) {
    return 'No se pudo llegar al puente.';
  }
  return http?.message ?? String(error);
}

function readTab(): SettingsTab {
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((tab) => tab.id === saved)
      ? (saved as SettingsTab)
      : 'correo';
  } catch {
    return 'correo';
  }
}
