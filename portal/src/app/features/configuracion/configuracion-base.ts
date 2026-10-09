import { IaService } from '../../core/ia/ia.service';
import { AjustesPortalService } from '../../core/config/ajustes-portal.service';
import { Directive, computed, inject, isDevMode, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  gatewayOverride,
  setGatewayOverride
} from '../../core/config/gateway-override';
import {
  ACCOUNT_COLORS,
  correoCuentasLine,
  isMailKind
} from '../../core/config/local-settings';
import { LocalSettingsStore } from '../../core/config/local-settings.store';
import { LicenciasService } from '../../core/licencias/licencias.service';
import { aplicarLicencias } from '../../core/licencias/licencias.util';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import {
  ConnectionMode,
  SourceConnection
} from '../../core/config/portal-config.model';
import {
  Account,
  AccountColor,
  LICENSE_PROVIDER_LABEL,
  LicenseAdjustment,
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
import { credencialesParaGuardar } from '../../core/util/credenciales-buzon.util';
import { plural } from '../../core/util/text.util';

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
  github: 'GitHub',
  openrouter: 'OpenRouter',
  prometheus: 'Servidores (Prometheus)',
  coolify: 'Coolify',
  cloudflare: 'Cloudflare'
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

const MODE_LABEL: Record<ConnectionMode, string> = {
  demo: 'Demostración',
  gateway: 'Datos reales',
  local: 'Solo en este navegador'
};

interface ConnectionRow {
  connection: SourceConnection;
  account?: Account;
  sync?: SyncState;
  kindLabel: string;
  modeLabel: string;
  /** El modo vigente, con lo que se cambió en esta sesión encima. */
  mode: ConnectionMode;
  capabilities: string[];
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
  /** Tal como llegó de la fuente. */
  license: LicenseUsage;
  /** Con las correcciones y la renovación confirmada encima. */
  vigente: LicenseUsage;
  account?: Account;
  edit?: LicenseAdjustment;
  /** Tiene costo, moneda, plan o fecha corregidos (no solo una confirmación). */
  corregida: boolean;
  hidden: boolean;
}

/** Borrador de la edición de una licencia; todo en texto por el formulario. */
interface LicenseDraft {
  cost: string;
  currency: string;
  plan: string;
  renewsAt: string;
}

/**
 * Todo lo que se configura desde los módulos: buzones, integraciones,
 * licencias, dominios, equipo, emisores de la API. No es un componente: cada
 * panel (`features/configuracion/`) hereda de aquí y pone su plantilla. Así
 * cada módulo trae su propia configuración sin duplicar la lógica.
 */
@Directive()
export class ConfiguracionBase {
  private readonly store = inject(PortalStore);
  private readonly local = inject(LocalSettingsStore);
  /** Cuentas, modos y buzones: compartidos desde el puente (o locales sin él). */
  readonly ajustes = inject(AjustesPortalService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly admin = inject(PuenteAdminService);

  readonly config = inject(PORTAL_CONFIG);
  /** Lo técnico (raíz del backend, token) solo se enseña en desarrollo. */
  readonly desarrollo = isDevMode();
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

  // --- Conexiones ---

  /** Cuentas quitadas en esta visita, para esconderlas sin recargar. */
  readonly quitadas = signal<ReadonlySet<string>>(new Set());

  readonly rows = computed<ConnectionRow[]>(() => {
    const syncById = new Map(
      this.store.syncStates().map((state) => [state.sourceId, state])
    );
    // Lo que se quitó desaparece de inmediato, aunque el resto se aplique al
    // recargar.
    const quitadas = this.quitadas();
    const encendidasEnSesion = this.ajustes.encendidasEnSesion();
    const modosEnSesion = this.ajustes.modosEnSesion();
    return this.config.connections
      .filter((c) => !quitadas.has(c.accountId))
      .map((connection) => {
        const account = this.store.accountOf(connection.accountId);
        const added = this.ajustes.isAdded(connection.accountId);
        // Lo cambiado en esta sesión se ve al instante; los adaptadores lo
        // toman al recargar.
        const mode =
          connection.mode === 'local'
            ? connection.mode
            : (modosEnSesion[connection.id] ?? connection.mode);
        return {
          connection,
          account,
          sync: syncById.get(connection.id),
          kindLabel: KIND_LABEL[connection.kind],
          modeLabel: MODE_LABEL[mode],
          mode,
          capabilities: connection.provides.map(
            (capability) => CAPABILITY_LABEL[capability]
          ),
          enabled:
            encendidasEnSesion[connection.accountId] ??
            account?.enabled ??
            true,
          added,
          puenteLine:
            added && account && isMailKind(account.kind)
              ? correoCuentasLine(account)
              : undefined
        };
      });
  });

  /** Los buzones, con los que faltan por conectar al principio. */
  readonly mailRows = computed(() => {
    const peso = (row: ConnectionRow) => {
      const metodo = this.estadoDe(row.connection.accountId)?.metodo;
      return metodo === 'graph' || metodo === 'imap'
        ? 2
        : metodo === 'envio'
          ? 1
          : 0;
    };
    return this.rows()
      .filter((row) => isMailKind(row.connection.kind))
      .sort((a, b) => peso(a) - peso(b));
  });

  /** Texto y color del distintivo de conexión de un buzón. */
  conexionChip(row: ConnectionRow): { label: string; clase: string } {
    const estado = this.estadoDe(row.connection.accountId);
    switch (estado?.metodo) {
      case 'graph':
      case 'imap':
        return {
          label: 'Conectado',
          clase:
            'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
        };
      case 'envio':
        return {
          label: 'Por barrido',
          clase:
            'bg-sky-100 text-sky-700 dark:bg-stone-500/20 dark:text-stone-200'
        };
      default:
        return {
          label: 'Por conectar',
          clase:
            'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
        };
    }
  }
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

  /** Un ajuste compartido no se pudo guardar en el puente. */
  readonly ajustesError = signal<string | undefined>(undefined);

  setAccountEnabled(accountId: string, enabled: boolean): void {
    this.ajustesError.set(undefined);
    this.ajustes.setAccountEnabled(accountId, enabled).subscribe({
      next: () => this.needsReload.set(true),
      error: (error: unknown) => this.ajustesError.set(describeHttp(error))
    });
  }

  removeAccount(accountId: string): void {
    const cuenta = this.store.accountOf(accountId);
    const nombre = cuenta
      ? `${cuenta.label} (${cuenta.detail.split(' ')[0]})`
      : accountId;
    if (
      !confirm(
        `¿Quitar el buzón ${nombre}?\n\nSe borran su conexión y sus credenciales; sus juntas, pendientes y licencias dejan de aparecer.`
      )
    ) {
      return;
    }
    const terminar = () => {
      this.ajustes.removeAccount(accountId).subscribe({
        next: () => {
          this.quitadas.update((q) => new Set([...q, accountId]));
          this.needsReload.set(true);
        },
        error: (error: unknown) =>
          this.pruebas.update((p) => ({
            ...p,
            [accountId]: { ok: false, mensaje: describeHttp(error) }
          }))
      });
    };
    if (this.admin.disponible) {
      this.admin.borrarBuzon(accountId).subscribe({
        next: terminar,
        error: (error: unknown) => {
          this.pruebas.update((p) => ({
            ...p,
            [accountId]: { ok: false, mensaje: describeHttp(error) }
          }));
        }
      });
      return;
    }
    terminar();
  }

  /** Demostración o datos reales del puente, por conexión. Requiere recargar. */
  setConnectionMode(row: ConnectionRow, gateway: boolean): void {
    this.ajustesError.set(undefined);
    this.ajustes
      .setConnectionMode(row.connection.id, gateway ? 'gateway' : 'demo')
      .subscribe({
        next: () => this.needsReload.set(true),
        error: (error: unknown) => this.ajustesError.set(describeHttp(error))
      });
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
      // Se quitan solo los parametros del resultado; `tab` se conserva para no
      // sacar al usuario de la pestana de Correo.
      void this.router.navigate([], {
        queryParams: { correo: null, oauth: null, mensaje: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
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
      // Solo el client ID de la aplicación PROPIA del buzón; el de la general
      // no se copia aquí (se vería como si fuera del buzón). El secreto nunca
      // regresa del puente: arranca vacío.
      clientId: estado?.appPropiaClientId ?? '',
      clientSecret: ''
    });
    this.conexionEditando.set(row.connection.accountId);
  }

  cancelConnectionEdit(): void {
    this.conexionEditando.set(undefined);
    this.credDraft.set({});
  }

  updateCred(patch: Partial<CredencialesBuzon>): void {
    this.credDraft.update((current) => ({ ...current, ...patch }));
  }

  saveConnection(row: ConnectionRow): void {
    const id = row.connection.accountId;
    // La aplicación general de Entra ID se configura una vez en Integraciones;
    // por buzón viajan el correo, el tenant y, si se escribió, la aplicación
    // propia (client ID y secret).
    this.ocupado.set(id);
    this.admin
      .guardar(id, credencialesParaGuardar(this.credDraft()))
      .subscribe({
        next: (estado) => {
          this.conexiones.update((c) => ({ ...c, [id]: { estado } }));
          this.pruebas.update((p) => ({
            ...p,
            [id]: { ok: true, mensaje: 'Guardado.' }
          }));
          this.conexionEditando.set(undefined);
          // El secreto escrito no se queda en memoria del portal.
          this.credDraft.set({});
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
    if (!this.estadoDe(id)?.conAplicacion) {
      const google = row.connection.kind === 'google';
      this.pruebas.update((p) => ({
        ...p,
        [id]: {
          ok: false,
          mensaje: google
            ? 'Primero configura la aplicación OAuth de Google (client ID y secret) en la tarjeta "Google (Gmail)" de este módulo y guárdala.'
            : 'Primero configura la aplicación de Entra ID (client ID y secret) en la tarjeta "Microsoft (Entra ID)" de este módulo y guárdala.'
        }
      }));
      return;
    }
    this.ocupado.set(id);
    // Directo a la pestana de Correo: la ruta vieja `/correo` redirige y la
    // redireccion pierde los parametros del resultado (oauth, correo, mensaje).
    const volver = `${location.origin}/integraciones?tab=correo`;
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
          [estado.id]: { ok: true, mensaje: 'Guardado.' }
        }));
        this.integracionEditando.set(undefined);
        this.ocupado.set(undefined);
        // Ya configurada en el puente: las conexiones de esa integración pasan
        // a datos reales, que es para lo que se capturó la credencial.
        // La aplicación de Microsoft cambia lo que cada buzón puede hacer.
        if (nuevo.id === 'microsoft' || nuevo.id === 'google') {
          this.loadConnections();
        }
        // Configurada: sus cuentas se encienden y pasan a datos reales.
        if (nuevo.configurada) {
          for (const row of this.otherRows()) {
            if (row.connection.kind !== nuevo.kind) {
              continue;
            }
            if (row.mode !== 'gateway') {
              this.setConnectionMode(row, true);
            }
            if (!row.enabled) {
              this.setAccountEnabled(row.connection.accountId, true);
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

  /** La aplicación de Entra ID, que se muestra en Correo si hay buzones de Microsoft. */
  readonly microsoftApp = computed(() =>
    this.mailRows().some((row) => row.connection.kind === 'microsoft')
      ? (this.integraciones() ?? []).find((i) => i.id === 'microsoft')
      : undefined
  );

  /** La aplicación OAuth de Google, si hay buzones de Gmail. */
  readonly googleApp = computed(() =>
    this.mailRows().some((row) => row.connection.kind === 'google')
      ? (this.integraciones() ?? []).find((i) => i.id === 'google')
      : undefined
  );

  /** Integraciones del puente que no corresponden a ninguna conexión (Acceso). */
  readonly integracionesSueltas = computed(() => {
    const kinds = new Set(
      this.otherRows().map((row) => row.connection.kind as string)
    );
    return (this.integraciones() ?? []).filter(
      (i) =>
        !kinds.has(i.kind) && !(i.id === 'microsoft' && this.microsoftApp())
    );
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

  readonly estatusMensaje = signal<string | undefined>(undefined);

  private readonly iaSvc = inject(IaService);

  /** Modelos recomendados que la cuenta de OpenRouter puede usar. */
  readonly modelosIa = signal<
    { id: string; nota: string; entrada: number; salida: number }[]
  >([]);

  cargarModelosIa(): void {
    if (!this.admin.disponible) {
      return;
    }
    this.iaSvc.modelos().subscribe({
      next: (r) => this.modelosIa.set(r.modelos),
      error: () => undefined
    });
  }
  /** Que dias y a que hora se pide estatus; de inicio martes y jueves a las 9. */
  readonly estatusProg = signal<{ dias: number[]; hora: number }>({
    dias: [2, 4],
    hora: 9
  });
  readonly diasSemana = [
    { n: 1, l: 'L' },
    { n: 2, l: 'M' },
    { n: 3, l: 'X' },
    { n: 4, l: 'J' },
    { n: 5, l: 'V' },
    { n: 6, l: 'S' },
    { n: 0, l: 'D' }
  ];

  cargarEstatusProg(): void {
    if (!this.admin.disponible) {
      return;
    }
    this.admin.estatusConfig().subscribe({
      next: (c) => this.estatusProg.set(c),
      error: () => undefined
    });
  }

  alternarDiaEstatus(dia: number): void {
    const actual = this.estatusProg();
    const dias = actual.dias.includes(dia)
      ? actual.dias.filter((d) => d !== dia)
      : [...actual.dias, dia].sort();
    this.guardarEstatusProg({ ...actual, dias });
  }

  ponerHoraEstatus(hora: string): void {
    const h = Number(hora.split(':')[0]);
    if (Number.isInteger(h)) {
      this.guardarEstatusProg({ ...this.estatusProg(), hora: h });
    }
  }

  private guardarEstatusProg(config: { dias: number[]; hora: number }): void {
    this.estatusProg.set(config);
    this.admin.guardarEstatusConfig(config).subscribe({
      next: (c) => this.estatusProg.set(c),
      error: (error: unknown) => this.estatusMensaje.set(describeHttp(error))
    });
  }

  /** Manda el correo de estatus a quienes tienen la marca. */
  solicitarEstatus(): void {
    this.ocupado.set('estatus');
    this.estatusMensaje.set(undefined);
    this.admin.solicitarEstatus().subscribe({
      next: (r) => {
        this.ocupado.set(undefined);
        this.estatusMensaje.set(
          r.enviados.length
            ? `Pedido a ${r.enviados.join(', ')}.`
            : 'Nadie marcado con pendientes abiertos (o sin correo).'
        );
        if (r.errores.length) {
          this.estatusMensaje.update(
            (m) => `${m} Errores: ${r.errores.join('; ')}`
          );
        }
      },
      error: (error: unknown) => {
        this.ocupado.set(undefined);
        this.estatusMensaje.set(describeHttp(error));
      }
    });
  }

  saveEquipo(): void {
    this.ocupado.set('equipo');
    this.admin.guardarEquipo(this.equipoDraft()).subscribe({
      next: (personas) => {
        this.equipo.set(personas);
        this.equipoDraft.set(personas.map((p) => ({ ...p })));
        // Lo que usan las tarjetas y los filtros para asignar: sin esperar
        // a recargar la pagina.
        this.iaSvc.equipo.set(personas);
        this.equipoMensaje.set({
          ok: true,
          mensaje: 'Equipo guardado.'
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
          mensaje: 'Dominios guardados.'
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

  addMail(alTerminar?: () => void): void {
    if (!this.canAddMail()) {
      return;
    }
    this.ajustesError.set(undefined);
    this.ajustes
      .addMailAccount(
        {
          label: this.newMailLabel(),
          email: this.newMailEmail(),
          kind: this.newMailKind(),
          color: this.newMailColor()
        },
        new Set(this.config.accounts.map((account) => account.id))
      )
      .subscribe({
        next: () => {
          this.newMailLabel.set('');
          this.newMailEmail.set('');
          this.needsReload.set(true);
          alTerminar?.();
        },
        error: (error: unknown) => this.ajustesError.set(describeHttp(error))
      });
  }

  // --- Licencias ---
  //
  // Las correcciones y las licencias a mano viven en el puente (sin puente, en
  // este navegador): `LicenciasService` decide dónde.

  private readonly licenciasSvc = inject(LicenciasService);

  readonly licenseRows = computed<LicenseRow[]>(() => {
    const edits = this.licenciasSvc.ajustes();
    return this.store.fetchedLicenses().map((license) => ({
      license,
      vigente: aplicarLicencias([license], [], edits)[0] ?? license,
      account: this.store.accountOf(license.accountId),
      edit: edits[license.id],
      corregida: corrigeAlgo(edits[license.id]),
      hidden: edits[license.id]?.hidden === true
    }));
  });

  readonly manualLicenses = computed(() => {
    const edits = this.licenciasSvc.ajustes();
    return this.licenciasSvc.manuales().map((license) => ({
      license: aplicarLicencias([], [license], edits)[0] ?? license,
      account: this.store.accountOf(license.accountId)
    }));
  });

  /** Lo capturado en este navegador que falta subir al puente. */
  readonly licenciasPendientesDeSubir = this.licenciasSvc.pendientesDeSubir;

  /** Error al guardar una corrección, para mostrarlo en la página. */
  readonly licenseError = signal<string | undefined>(undefined);

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
    const hayCosto = cost !== undefined && Number.isFinite(cost);
    // `null` quita esa corrección; lo que no cambió respecto a la fuente no se guarda.
    this.licenseError.set(undefined);
    this.licenciasSvc
      .guardarAjuste(row.license.id, {
        cost: hayCosto ? cost : null,
        currency: hayCosto ? draft.currency.trim().toUpperCase() : null,
        plan:
          draft.plan.trim() !== (row.license.plan ?? '')
            ? draft.plan.trim() || null
            : null,
        renewsAt:
          draft.renewsAt &&
          draft.renewsAt !== row.license.renewsAt?.slice(0, 10)
            ? draft.renewsAt
            : null,
        hidden: row.hidden
      })
      .subscribe({
        next: () => this.editing.set(undefined),
        error: (e: unknown) => this.licenseError.set(describeHttp(e))
      });
  }

  setHidden(row: LicenseRow, hidden: boolean): void {
    this.licenseError.set(undefined);
    this.licenciasSvc.guardarAjuste(row.license.id, { hidden }).subscribe({
      error: (e: unknown) => this.licenseError.set(describeHttp(e))
    });
  }

  clearEdit(row: LicenseRow): void {
    this.licenseError.set(undefined);
    this.licenciasSvc.quitarAjuste(row.license.id).subscribe({
      error: (e: unknown) => this.licenseError.set(describeHttp(e))
    });
  }

  updateDraft(patch: Partial<LicenseDraft>): void {
    this.draft.update((current) => ({ ...current, ...patch }));
  }

  removeManualLicense(id: string): void {
    this.licenseError.set(undefined);
    this.licenciasSvc.borrarManual(id).subscribe({
      error: (e: unknown) => this.licenseError.set(describeHttp(e))
    });
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

  statusClass(status: SyncState['status'] | undefined): string {
    switch (status) {
      case 'lista':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
      case 'error':
        return 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300';
      case 'sincronizando':
        return 'bg-sky-100 text-sky-700 dark:bg-stone-500/20 dark:text-stone-200';
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

function corrigeAlgo(ajuste: LicenseAdjustment | undefined): boolean {
  return (
    !!ajuste &&
    (ajuste.cost !== undefined ||
      ajuste.currency !== undefined ||
      ajuste.plan !== undefined ||
      ajuste.renewsAt !== undefined)
  );
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
    return 'No se pudo llegar al servidor.';
  }
  return http?.message ?? String(error);
}
