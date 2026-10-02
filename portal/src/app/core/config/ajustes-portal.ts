import { Account, AccountColor, AjustesPortal, SourceKind } from '../models';
import {
  ACCOUNT_COLORS,
  EMPTY_SETTINGS,
  LocalSettings,
  isMailKind,
  withLocalSettings
} from './local-settings';
import { PortalConfig } from './portal-config.model';

/**
 * La lógica pura de los ajustes compartidos (los que viven en el puente):
 * qué manda sobre qué, cómo se mezclan con la configuración de fábrica y qué
 * del navegador se puede subir. Sin Angular, para poder probarla suelta.
 */

type Modo = 'gateway' | 'demo';

const ID_CUENTA = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ID_BUZON = /^correo-[a-z0-9][a-z0-9-]{0,56}$/;

/** Lo que contesta el servidor, ya revisado: listas y mapas siempre completos. */
export function normalizarAjustes(raw: unknown): AjustesPortal | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const r = raw as Partial<Record<keyof AjustesPortal, unknown>>;
  const mapa = <T>(v: unknown, vale: (x: unknown) => x is T) =>
    Object.fromEntries(
      Object.entries(
        v && typeof v === 'object' && !Array.isArray(v) ? v : {}
      ).filter((par): par is [string, T] => vale(par[1]))
    ) as Record<string, T>;
  return {
    cuentasApagadas: mapa(
      r.cuentasApagadas,
      (x): x is boolean => typeof x === 'boolean'
    ),
    modos: mapa(r.modos, (x): x is Modo => x === 'gateway' || x === 'demo'),
    buzonesAgregados: Array.isArray(r.buzonesAgregados)
      ? (r.buzonesAgregados as Account[]).filter(
          (a) => !!a && typeof a.id === 'string'
        )
      : [],
    buzonesQuitados: Array.isArray(r.buzonesQuitados)
      ? r.buzonesQuitados.filter((x): x is string => typeof x === 'string')
      : [],
    actualizadoEn: typeof r.actualizadoEn === 'string' ? r.actualizadoEn : '',
    actualizadoPor: typeof r.actualizadoPor === 'string' ? r.actualizadoPor : ''
  };
}

/** El servidor ya tiene ajustes guardados (alguien los subió o los cambió). */
export function servidorTieneAjustes(
  ajustes: AjustesPortal | undefined
): ajustes is AjustesPortal {
  return !!ajustes && ajustes.actualizadoEn !== '';
}

/**
 * La configuración de fábrica con los ajustes del servidor encima: las mismas
 * reglas que los ajustes locales (apagadas, modos, buzones agregados y
 * quitados), porque es lo mismo, solo que compartido.
 */
export function aplicarAjustesServidor(
  base: PortalConfig,
  ajustes: AjustesPortal
): PortalConfig {
  return withLocalSettings(base, comoLocales(ajustes));
}

function comoLocales(ajustes: AjustesPortal): LocalSettings {
  return {
    ...EMPTY_SETTINGS,
    accounts: ajustes.buzonesAgregados,
    accountEnabled: ajustes.cuentasApagadas,
    removedAccounts: ajustes.buzonesQuitados,
    connectionMode: ajustes.modos
  };
}

/** Alguno de los cuatro campos de cuentas/modos del navegador trae algo. */
export function hayAjustesLocales(local: LocalSettings): boolean {
  return (
    local.accounts.length > 0 ||
    local.removedAccounts.length > 0 ||
    Object.keys(local.accountEnabled).length > 0 ||
    Object.keys(local.connectionMode).length > 0
  );
}

/**
 * Lo del navegador, listo para subir al servidor: lo que el puente no
 * aceptaría (ids raros, modo `local`, buzones que no son de correo) se deja
 * fuera para que un renglón viejo no tire toda la subida.
 */
export function ajustesParaSubir(local: LocalSettings): {
  cuentasApagadas: Record<string, boolean>;
  modos: Record<string, Modo>;
  buzonesAgregados: Account[];
  buzonesQuitados: string[];
} {
  const vistos = new Set<string>();
  const buzonesAgregados: Account[] = [];
  for (const a of local.accounts) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !ID_BUZON.test(a.id) ||
      vistos.has(a.id) ||
      !isMailKind(a.kind as SourceKind) ||
      !(ACCOUNT_COLORS as readonly string[]).includes(a.color as AccountColor)
    ) {
      continue;
    }
    vistos.add(a.id);
    buzonesAgregados.push({
      id: a.id,
      label: String(a.label ?? a.id).trim() || a.id,
      detail: String(a.detail ?? ''),
      kind: a.kind,
      color: a.color,
      enabled: a.enabled !== false
    });
  }
  return {
    cuentasApagadas: Object.fromEntries(
      Object.entries(local.accountEnabled).filter(
        ([id, v]) => ID_CUENTA.test(id) && typeof v === 'boolean'
      )
    ),
    modos: Object.fromEntries(
      Object.entries(local.connectionMode).filter(
        (par): par is [string, Modo] =>
          ID_CUENTA.test(par[0]) && (par[1] === 'gateway' || par[1] === 'demo')
      )
    ),
    buzonesAgregados,
    buzonesQuitados: [
      ...new Set(local.removedAccounts.filter((id) => ID_BUZON.test(id)))
    ]
  };
}

/**
 * Los ajustes del navegador sin lo de cuentas y modos. Las licencias
 * (`licenseEdits`, `manualLicenses`) se dejan intactas: no son de aquí.
 */
export function sinAjustesDeCuentas(local: LocalSettings): LocalSettings {
  return {
    ...local,
    accounts: [],
    accountEnabled: {},
    removedAccounts: [],
    connectionMode: {}
  };
}

/**
 * Las cuentas que el usuario apagó a propósito: lo que sigue apagado aunque
 * el backend diga que la integración está configurada.
 */
export function apagadasAProposito(
  cuentasApagadas: Record<string, boolean>
): Set<string> {
  return new Set(
    Object.entries(cuentasApagadas)
      .filter(([, enabled]) => enabled === false)
      .map(([id]) => id)
  );
}
