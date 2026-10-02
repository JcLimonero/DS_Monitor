/**
 * Los ajustes del portal que antes vivian en el navegador de cada quien y
 * ahora se comparten desde el puente: apagar una fuente, pasar una conexion
 * de demostracion a datos reales, y agregar o quitar buzones.
 *
 * Es un solo documento (`ajustes-portal`). `actualizadoEn` vacio quiere decir
 * "nadie ha guardado nada": el portal entonces se queda con lo suyo (lo
 * guardado en el navegador o la configuracion de fabrica) y ofrece subirlo.
 * En cuanto hay una fecha, lo del servidor manda en todos los dispositivos.
 */

export type ModoConexion = 'gateway' | 'demo';
export const MODOS: readonly ModoConexion[] = ['gateway', 'demo'];

/** Lo que el puente acepta como buzon agregado a mano (solo correo). */
export const TIPOS_BUZON = ['google', 'microsoft', 'imap'] as const;
export type TipoBuzon = (typeof TIPOS_BUZON)[number];

export const COLORES = [
  'sky',
  'violet',
  'emerald',
  'amber',
  'rose',
  'slate',
  'indigo',
  'teal',
  'orange',
  'fuchsia',
  'cyan'
] as const;
export type ColorCuenta = (typeof COLORES)[number];

/** Un buzon agregado desde el portal: la misma forma que `Account` del portal. */
export interface CuentaPortal {
  id: string;
  label: string;
  detail: string;
  kind: TipoBuzon;
  color: ColorCuenta;
  enabled: boolean;
}

export interface AjustesPortal {
  /** Encendido/apagado explicito por cuenta (id → enabled), sobre el de fabrica. */
  cuentasApagadas: Record<string, boolean>;
  /** Modo por conexion (id de conexion → gateway o demo). */
  modos: Record<string, ModoConexion>;
  buzonesAgregados: CuentaPortal[];
  /** Buzones de fabrica que se quitaron desde la aplicacion. */
  buzonesQuitados: string[];
  /** Vacio mientras nadie haya guardado nada. */
  actualizadoEn: string;
  actualizadoPor: string;
}

export const AJUSTES_VACIOS: AjustesPortal = {
  cuentasApagadas: {},
  modos: {},
  buzonesAgregados: [],
  buzonesQuitados: [],
  actualizadoEn: '',
  actualizadoPor: ''
};

/** Un parche parcial: una sola operacion por llamada. */
export interface ParcheAjustes {
  cuentaEnabled?: { id: string; enabled: boolean };
  modo?: { id: string; modo: ModoConexion };
  agregarBuzon?: CuentaPortal;
  quitarBuzon?: string;
}

/** Topes para que un cliente roto no llene el documento. */
export const MAX_BUZONES = 50;
export const MAX_ENTRADAS = 200;

const ID_CUENTA = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ID_BUZON = /^correo-[a-z0-9][a-z0-9-]{0,56}$/;

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

function idCuenta(valor: unknown, que: string): string {
  const id = texto(valor);
  if (!id || !ID_CUENTA.test(id)) {
    throw new Error(`El id de ${que} no es válido.`);
  }
  return id;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return !!valor && typeof valor === 'object' && !Array.isArray(valor);
}

export function validarModo(valor: unknown): ModoConexion {
  if (typeof valor !== 'string' || !MODOS.includes(valor as ModoConexion)) {
    throw new Error(`El modo debe ser ${MODOS.join(' o ')}.`);
  }
  return valor as ModoConexion;
}

/** Un buzon agregado: id `correo-…`, tipo de correo, etiqueta y color validos. */
export function validarBuzon(crudo: unknown): CuentaPortal {
  if (!esObjeto(crudo)) {
    throw new Error('El buzón debe ser un objeto.');
  }
  const id = texto(crudo['id']);
  if (!id || !ID_BUZON.test(id)) {
    throw new Error('El id del buzón debe empezar con "correo-".');
  }
  const label = texto(crudo['label']);
  if (!label) {
    throw new Error(`El buzón "${id}" necesita una etiqueta.`);
  }
  const kind = crudo['kind'];
  if (!TIPOS_BUZON.includes(kind as TipoBuzon)) {
    throw new Error(
      `El tipo del buzón "${id}" debe ser ${TIPOS_BUZON.join(', ')}.`
    );
  }
  const color = crudo['color'];
  if (!COLORES.includes(color as ColorCuenta)) {
    throw new Error(`El color del buzón "${id}" no es válido.`);
  }
  return {
    id,
    label: label.slice(0, 60),
    detail: (texto(crudo['detail']) ?? '').slice(0, 200),
    kind: kind as TipoBuzon,
    color: color as ColorCuenta,
    enabled: crudo['enabled'] !== false
  };
}

function unicos(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * El documento completo tal como lo manda el portal (por ejemplo, al subir lo
 * que tenia en el navegador): valida cada parte, no deja buzones repetidos y
 * respeta los topes. Lo que no viene se toma como vacio.
 */
export function validarDocumento(
  crudo: unknown,
  ahora: string,
  por: string
): AjustesPortal {
  if (!esObjeto(crudo)) {
    throw new Error('Los ajustes deben ser un objeto.');
  }
  const apagadas: Record<string, boolean> = {};
  const rawApagadas = crudo['cuentasApagadas'] ?? {};
  if (!esObjeto(rawApagadas)) {
    throw new Error('"cuentasApagadas" debe ser un mapa.');
  }
  for (const [id, enabled] of Object.entries(rawApagadas)) {
    if (typeof enabled !== 'boolean') {
      throw new Error(`"cuentasApagadas.${id}" debe ser verdadero o falso.`);
    }
    apagadas[idCuenta(id, 'cuenta')] = enabled;
  }
  const modos: Record<string, ModoConexion> = {};
  const rawModos = crudo['modos'] ?? {};
  if (!esObjeto(rawModos)) {
    throw new Error('"modos" debe ser un mapa.');
  }
  for (const [id, modo] of Object.entries(rawModos)) {
    modos[idCuenta(id, 'conexión')] = validarModo(modo);
  }
  const rawBuzones = crudo['buzonesAgregados'] ?? [];
  if (!Array.isArray(rawBuzones)) {
    throw new Error('"buzonesAgregados" debe ser una lista.');
  }
  const buzones = rawBuzones.map(validarBuzon);
  const vistos = new Set<string>();
  for (const b of buzones) {
    if (vistos.has(b.id)) {
      throw new Error(`El buzón "${b.id}" está repetido.`);
    }
    vistos.add(b.id);
  }
  const rawQuitados = crudo['buzonesQuitados'] ?? [];
  if (!Array.isArray(rawQuitados)) {
    throw new Error('"buzonesQuitados" debe ser una lista.');
  }
  const quitados = unicos(
    rawQuitados.map((id) => {
      const limpio = texto(id);
      if (!limpio || !ID_BUZON.test(limpio)) {
        throw new Error('Un buzón quitado debe llamarse "correo-…".');
      }
      return limpio;
    })
  );
  const doc: AjustesPortal = {
    cuentasApagadas: apagadas,
    modos,
    buzonesAgregados: buzones,
    buzonesQuitados: quitados,
    actualizadoEn: ahora,
    actualizadoPor: por
  };
  verificarTopes(doc);
  return doc;
}

function verificarTopes(doc: AjustesPortal): void {
  if (doc.buzonesAgregados.length > MAX_BUZONES) {
    throw new Error(`Máximo ${MAX_BUZONES} buzones agregados.`);
  }
  if (
    Object.keys(doc.cuentasApagadas).length > MAX_ENTRADAS ||
    Object.keys(doc.modos).length > MAX_ENTRADAS ||
    doc.buzonesQuitados.length > MAX_ENTRADAS
  ) {
    throw new Error(`Máximo ${MAX_ENTRADAS} entradas por ajuste.`);
  }
}

/**
 * Aplica una operacion al documento actual y devuelve el nuevo (no muta el
 * anterior). Una llamada trae una sola operacion; si no trae ninguna, es un
 * error. Quitar un buzon agregado lo saca de la lista; quitar uno de fabrica
 * lo anota como quitado; en los dos casos se olvidan su encendido y su modo.
 */
export function aplicarParche(
  previo: AjustesPortal,
  crudo: unknown,
  ahora: string,
  por: string
): AjustesPortal {
  if (!esObjeto(crudo)) {
    throw new Error('El parche debe ser un objeto.');
  }
  const operaciones = (
    ['cuentaEnabled', 'modo', 'agregarBuzon', 'quitarBuzon'] as const
  ).filter((k) => crudo[k] !== undefined);
  if (operaciones.length !== 1) {
    throw new Error(
      'Manda una sola operación: cuentaEnabled, modo, agregarBuzon o quitarBuzon.'
    );
  }
  const base: AjustesPortal = {
    cuentasApagadas: { ...previo.cuentasApagadas },
    modos: { ...previo.modos },
    buzonesAgregados: [...previo.buzonesAgregados],
    buzonesQuitados: [...previo.buzonesQuitados],
    actualizadoEn: ahora,
    actualizadoPor: por
  };
  switch (operaciones[0]) {
    case 'cuentaEnabled': {
      const op = crudo['cuentaEnabled'];
      if (!esObjeto(op) || typeof op['enabled'] !== 'boolean') {
        throw new Error('"cuentaEnabled" necesita id y enabled (booleano).');
      }
      base.cuentasApagadas[idCuenta(op['id'], 'cuenta')] = op['enabled'];
      break;
    }
    case 'modo': {
      const op = crudo['modo'];
      if (!esObjeto(op)) {
        throw new Error('"modo" necesita id y modo.');
      }
      base.modos[idCuenta(op['id'], 'conexión')] = validarModo(op['modo']);
      break;
    }
    case 'agregarBuzon': {
      const buzon = validarBuzon(crudo['agregarBuzon']);
      if (base.buzonesAgregados.some((b) => b.id === buzon.id)) {
        throw new Error(`Ya existe un buzón "${buzon.id}".`);
      }
      if (base.buzonesQuitados.includes(buzon.id)) {
        throw new Error(
          `"${buzon.id}" es un buzón quitado; usa otro nombre para el nuevo.`
        );
      }
      base.buzonesAgregados.push(buzon);
      break;
    }
    case 'quitarBuzon': {
      const raw = texto(crudo['quitarBuzon']);
      if (!raw || !ID_BUZON.test(raw)) {
        throw new Error('El buzón a quitar debe llamarse "correo-…".');
      }
      const eraAgregado = base.buzonesAgregados.some((b) => b.id === raw);
      base.buzonesAgregados = base.buzonesAgregados.filter((b) => b.id !== raw);
      if (!eraAgregado && !base.buzonesQuitados.includes(raw)) {
        base.buzonesQuitados.push(raw);
      }
      delete base.cuentasApagadas[raw];
      delete base.modos[raw];
      break;
    }
  }
  verificarTopes(base);
  return base;
}
