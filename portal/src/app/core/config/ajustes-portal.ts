import { Account, AccountColor, AjustesPortal, SourceKind } from '../models';
import {
  ACCOUNT_COLORS,
  EMPTY_SETTINGS,
  LocalSettings,
  isMailKind,
  withLocalSettings
} from './local-settings';
import { ConnectionMode, PortalConfig } from './portal-config.model';

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

/** El documento que se sube: lo del navegador que el puente sí acepta. */
export interface DocumentoAjustes {
  cuentasApagadas: Record<string, boolean>;
  modos: Record<string, Modo>;
  buzonesAgregados: Account[];
  buzonesQuitados: string[];
}

/** Lo que no se puede subir: se queda en el navegador hasta que alguien lo descarte. */
export interface Omitidos {
  accounts: Account[];
  accountEnabled: Record<string, boolean>;
  connectionMode: Record<string, ConnectionMode>;
  removedAccounts: string[];
  /** Cuántas entradas son, en total. */
  total: number;
  /** Por qué, en palabras: "2 con id no válido o demasiado largo". */
  motivos: string[];
}

const MOTIVO_ID = 'con id no válido o demasiado largo';
const MOTIVO_TIPO = 'buzones de un tipo o color que el servidor no acepta';
const MOTIVO_LOCAL = 'en modo «local» (solo vale en este navegador)';

/**
 * Lo del navegador, partido en lo que el puente acepta y lo que no (ids
 * raros o de más de 64 caracteres, modo `local`, buzones que no son de
 * correo). Lo segundo no se sube ni se pierde en silencio: queda en
 * `omitidos`, con sus motivos, para avisarlo.
 */
export function prepararSubida(local: LocalSettings): {
  documento: DocumentoAjustes;
  omitidos: Omitidos;
} {
  const razones = new Map<string, number>();
  const anotar = (razon: string) =>
    razones.set(razon, (razones.get(razon) ?? 0) + 1);
  const vistos = new Set<string>();
  const buzonesAgregados: Account[] = [];
  const omitidos: Omitidos = {
    accounts: [],
    accountEnabled: {},
    connectionMode: {},
    removedAccounts: [],
    total: 0,
    motivos: []
  };
  for (const a of local.accounts) {
    if (!a || typeof a.id !== 'string' || !ID_BUZON.test(a.id)) {
      if (a) {
        omitidos.accounts.push(a);
      }
      anotar(`buzones ${MOTIVO_ID}`);
      continue;
    }
    if (vistos.has(a.id)) {
      // Repetido: ya va el primero, no hay nada que conservar.
      continue;
    }
    if (
      !isMailKind(a.kind as SourceKind) ||
      !(ACCOUNT_COLORS as readonly string[]).includes(a.color as AccountColor)
    ) {
      omitidos.accounts.push(a);
      anotar(MOTIVO_TIPO);
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
  const cuentasApagadas: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(local.accountEnabled)) {
    if (ID_CUENTA.test(id) && typeof v === 'boolean') {
      cuentasApagadas[id] = v;
    } else {
      omitidos.accountEnabled[id] = v;
      anotar(`cuentas ${MOTIVO_ID}`);
    }
  }
  const modos: Record<string, Modo> = {};
  for (const [id, m] of Object.entries(local.connectionMode)) {
    if (!ID_CUENTA.test(id)) {
      omitidos.connectionMode[id] = m;
      anotar(`conexiones ${MOTIVO_ID}`);
    } else if (m === 'gateway' || m === 'demo') {
      modos[id] = m;
    } else {
      omitidos.connectionMode[id] = m;
      anotar(`conexiones ${MOTIVO_LOCAL}`);
    }
  }
  const buzonesQuitados: string[] = [];
  for (const id of new Set(local.removedAccounts)) {
    if (typeof id === 'string' && ID_BUZON.test(id)) {
      buzonesQuitados.push(id);
    } else {
      omitidos.removedAccounts.push(id);
      anotar(`buzones quitados ${MOTIVO_ID}`);
    }
  }
  omitidos.total = [...razones.values()].reduce((a, b) => a + b, 0);
  omitidos.motivos = [...razones].map(([r, n]) => `${n} ${r}`);
  return {
    documento: { cuentasApagadas, modos, buzonesAgregados, buzonesQuitados },
    omitidos
  };
}

/** Solo el documento que se sube (ver `prepararSubida`). */
export function ajustesParaSubir(local: LocalSettings): DocumentoAjustes {
  return prepararSubida(local).documento;
}

export function documentoVacio(doc: DocumentoAjustes): boolean {
  return (
    doc.buzonesAgregados.length === 0 &&
    doc.buzonesQuitados.length === 0 &&
    Object.keys(doc.cuentasApagadas).length === 0 &&
    Object.keys(doc.modos).length === 0
  );
}

/** Los ajustes del navegador conservando solo lo que no se pudo subir. */
export function conSoloOmitidos(
  local: LocalSettings,
  omitidos: Omitidos
): LocalSettings {
  return {
    ...local,
    accounts: omitidos.accounts,
    accountEnabled: omitidos.accountEnabled,
    connectionMode: omitidos.connectionMode,
    removedAccounts: omitidos.removedAccounts
  };
}

/**
 * Lo que el navegador trae y el servidor aún no tiene, como parches sueltos
 * (nunca como documento completo): unión de buzones agregados y de quitados,
 * y en los mapas gana lo del servidor si ya tiene esa clave. Es lo que se
 * manda cuando otro dispositivo subió primero (409).
 */
export function parchesDeFusion(
  servidor: AjustesPortal,
  local: LocalSettings
): ParcheAjustes[] {
  const doc = ajustesParaSubir(local);
  const parches: ParcheAjustes[] = [];
  for (const b of doc.buzonesAgregados) {
    if (
      !servidor.buzonesAgregados.some((a) => a.id === b.id) &&
      !servidor.buzonesQuitados.includes(b.id)
    ) {
      parches.push({ agregarBuzon: b });
    }
  }
  for (const [id, enabled] of Object.entries(doc.cuentasApagadas)) {
    if (!(id in servidor.cuentasApagadas)) {
      parches.push({ cuentaEnabled: { id, enabled } });
    }
  }
  for (const [id, modo] of Object.entries(doc.modos)) {
    if (!(id in servidor.modos)) {
      parches.push({ modo: { id, modo } });
    }
  }
  // Al final: quitar un buzón también olvida su encendido y su modo.
  for (const id of doc.buzonesQuitados) {
    if (
      !servidor.buzonesQuitados.includes(id) &&
      !servidor.buzonesAgregados.some((a) => a.id === id)
    ) {
      parches.push({ quitarBuzon: id });
    }
  }
  return parches;
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

/** Una operación sobre los ajustes compartidos (la misma que acepta el puente). */
export interface ParcheAjustes {
  cuentaEnabled?: { id: string; enabled: boolean };
  modo?: { id: string; modo: Modo };
  agregarBuzon?: Account;
  quitarBuzon?: string;
}

/**
 * Aplica una operación sobre un documento (copia nueva). Es la misma regla
 * que el puente: quitar un buzón agregado lo saca de la lista, quitar uno de
 * fábrica lo anota como quitado, y en los dos casos se olvidan su encendido
 * y su modo.
 */
export function aplicarParcheADocumento(
  doc: DocumentoAjustes,
  parche: ParcheAjustes
): DocumentoAjustes {
  const r: DocumentoAjustes = {
    cuentasApagadas: { ...doc.cuentasApagadas },
    modos: { ...doc.modos },
    buzonesAgregados: [...doc.buzonesAgregados],
    buzonesQuitados: [...doc.buzonesQuitados]
  };
  if (parche.cuentaEnabled) {
    r.cuentasApagadas[parche.cuentaEnabled.id] = parche.cuentaEnabled.enabled;
  }
  if (parche.modo) {
    r.modos[parche.modo.id] = parche.modo.modo;
  }
  if (parche.agregarBuzon) {
    const nuevo = parche.agregarBuzon;
    r.buzonesAgregados = [
      ...r.buzonesAgregados.filter((a) => a.id !== nuevo.id),
      nuevo
    ];
  }
  if (parche.quitarBuzon) {
    const id = parche.quitarBuzon;
    const eraAgregado = r.buzonesAgregados.some((a) => a.id === id);
    r.buzonesAgregados = r.buzonesAgregados.filter((a) => a.id !== id);
    if (!eraAgregado && !r.buzonesQuitados.includes(id)) {
      r.buzonesQuitados.push(id);
    }
    delete r.cuentasApagadas[id];
    delete r.modos[id];
  }
  return r;
}

/**
 * Qué se manda al guardar un cambio. Con el servidor vacío y ajustes locales
 * en este navegador, el primer guardado manda el documento completo (lo local
 * más el cambio) para que nada quede fuera de vista; en cualquier otro caso,
 * solo el parche.
 */
export function cuerpoDeGuardado(
  servidorVacio: boolean,
  local: LocalSettings,
  parche: ParcheAjustes
): { cuerpo: Record<string, unknown>; subeLocal: boolean } {
  const { documento } = prepararSubida(local);
  if (servidorVacio && !documentoVacio(documento)) {
    return {
      cuerpo: { ajustes: aplicarParcheADocumento(documento, parche) },
      subeLocal: true
    };
  }
  return { cuerpo: { ...parche }, subeLocal: false };
}
