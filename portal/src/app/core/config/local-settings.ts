import { Account, AccountColor, LicenseUsage, SourceKind } from '../models';
import {
  ConnectionMode,
  PortalConfig,
  SourceConnection
} from './portal-config.model';

/**
 * Lo que se ajusta desde el portal mismo, sin tocar el código.
 *
 * Hay cosas que la configuración de fábrica no puede saber: un buzón nuevo,
 * el costo de una licencia que el recibo no trae, una licencia que se paga
 * pero no llega por correo, o una cuenta que se quiere apagar un rato. Todo
 * eso se captura en Ajustes y vive aquí.
 *
 * Se guarda en localStorage porque es una preferencia de esta máquina y no
 * hay backend para preferencias; el día que lo haya, este archivo es lo único
 * que cambia. Lo que sí queda claro desde ahora: un buzón agregado aquí solo
 * existe para el portal; el puente lo lee cuando alguien pone su línea en
 * `CORREO_CUENTAS`, y Ajustes muestra esa línea lista para copiar.
 */

const STORAGE_KEY = 'ds-monitor.ajustes.v1';

/** Lo que se puede corregir de una licencia que llegó de una fuente. */
export interface LicenseEdit {
  cost?: number;
  currency?: string;
  plan?: string;
  renewsAt?: string;
  /** True para sacarla del tablero sin borrarla de la fuente. */
  hidden?: boolean;
}

export interface LocalSettings {
  version: 1;
  /** Cuentas agregadas a mano. Hoy solo buzones de correo. */
  accounts: Account[];
  /** Encendido/apagado por cuenta, encima del valor de fábrica. */
  accountEnabled: Record<string, boolean>;
  /** Cuentas de fábrica que se borraron desde la aplicación. */
  removedAccounts: string[];
  /**
   * Modo por conexión, encima del de fábrica: `gateway` cuando la integración
   * ya quedó configurada en el puente y se quieren datos reales en vez de la
   * demostración.
   */
  connectionMode: Record<string, ConnectionMode>;
  /** Correcciones por identificador de licencia. */
  licenseEdits: Record<string, LicenseEdit>;
  /** Licencias que no vienen de ninguna fuente y se capturan aquí. */
  manualLicenses: LicenseUsage[];
}

export const EMPTY_SETTINGS: LocalSettings = {
  version: 1,
  accounts: [],
  accountEnabled: {},
  removedAccounts: [],
  connectionMode: {},
  licenseEdits: {},
  manualLicenses: []
};

export function readLocalSettings(): LocalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return EMPTY_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<LocalSettings>;
    return {
      version: 1,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      accountEnabled: parsed.accountEnabled ?? {},
      removedAccounts: Array.isArray(parsed.removedAccounts)
        ? parsed.removedAccounts
        : [],
      connectionMode: parsed.connectionMode ?? {},
      licenseEdits: parsed.licenseEdits ?? {},
      manualLicenses: Array.isArray(parsed.manualLicenses)
        ? parsed.manualLicenses
        : []
    };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function writeLocalSettings(settings: LocalSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento (modo privado, por ejemplo) no hay nada que guardar.
  }
}

/** Integraciones que son un buzón de correo. */
export const MAIL_KINDS: readonly SourceKind[] = [
  'google',
  'microsoft',
  'imap'
];

export function isMailKind(kind: SourceKind): boolean {
  return MAIL_KINDS.includes(kind);
}

/** La conexión que le corresponde a un buzón: siempre la misma forma. */
export function mailConnection(account: Account): SourceConnection {
  return {
    id: account.id,
    accountId: account.id,
    kind: account.kind,
    mode: 'gateway',
    provides: ['meetings', 'tasks', 'licenses'],
    path: `/correo/${account.id}`
  };
}

/**
 * La configuración de fábrica con los ajustes locales encima: cuentas
 * agregadas, encendido/apagado por cuenta, y una conexión por buzón nuevo.
 */
export function withLocalSettings(
  config: PortalConfig,
  settings: LocalSettings
): PortalConfig {
  const removed = new Set(settings.removedAccounts);
  const fromDefaults = new Set(config.accounts.map((account) => account.id));
  const added = settings.accounts.filter(
    (account) => !fromDefaults.has(account.id) && !removed.has(account.id)
  );
  const accounts = [
    ...config.accounts.filter((account) => !removed.has(account.id)),
    ...added
  ].map((account) => ({
    ...account,
    enabled: settings.accountEnabled[account.id] ?? account.enabled
  }));
  const connections = [
    ...config.connections.filter((c) => !removed.has(c.accountId)),
    ...added.filter((a) => isMailKind(a.kind)).map(mailConnection)
  ].map((connection) => {
    const mode = settings.connectionMode[connection.id];
    // Lo local no puede mandar a `local`: eso es solo de los pendientes propios.
    return mode && connection.mode !== 'local'
      ? { ...connection, mode }
      : connection;
  });
  return { ...config, accounts, connections };
}

/** `Correo de la oficina` -> `correo-correo-de-la-oficina`. */
export function accountIdFor(
  label: string,
  taken: ReadonlySet<string>
): string {
  const base =
    'correo-' +
    (label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'buzon');
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base}-${n}`;
  }
  return id;
}

/**
 * La línea que hay que pegar en `CORREO_CUENTAS` del puente para que ese
 * buzón se lea de verdad. El host es el habitual de cada proveedor; Neubox y
 * otros IMAP usan `mail.<dominio>`.
 */
export function correoCuentasLine(account: Account): string {
  const email = account.detail.split(' ')[0] ?? '';
  const domain = email.split('@')[1] ?? '';
  const host =
    account.kind === 'google'
      ? 'imap.gmail.com'
      : account.kind === 'microsoft'
        ? 'outlook.office365.com'
        : domain.endsWith('icloud.com') || domain.endsWith('me.com')
          ? 'imap.mail.me.com'
          : `mail.${domain}`;
  const buzon = account.kind === 'google' ? '[Gmail]/Todos' : 'INBOX';
  return `${account.id}|${account.kind}|${host}|993|${email}|${buzon}`;
}

export const ACCOUNT_COLORS: readonly AccountColor[] = [
  'sky',
  'violet',
  'emerald',
  'amber',
  'rose',
  'indigo',
  'teal',
  'orange',
  'fuchsia',
  'cyan',
  'slate'
];
