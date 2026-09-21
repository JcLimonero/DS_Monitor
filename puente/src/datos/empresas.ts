import type { Empresa, TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from '../pendientes/anotaciones.js';
import type { Aprendizajes } from '../pendientes/aprendido.js';
import type { Registro } from '../pendientes/registro.js';

export type { Empresa };

/**
 * El catalogo de empresas del grupo.
 *
 * Antes las cuatro empresas estaban fijas en codigo; ahora se capturan desde
 * Integraciones → Empresas y de aqui salen los selectores del portal, los
 * filtros, el contexto que se le da al modelo en cada prompt y a que empresa
 * pertenece cada buzon. La primera vez que el puente arranca con la lista
 * vacia se siembran las cuatro de siempre.
 *
 * El nombre es la llave con la que se etiquetan los pendientes (`company`),
 * asi que al renombrar una empresa se reetiqueta lo ya guardado.
 */

const AHORA_INICIAL = '2026-01-01T00:00:00.000Z';

export const EMPRESAS_INICIALES: Empresa[] = [
  {
    id: 'itech-dev',
    nombre: 'Itech Dev',
    descripcion: 'desarrollo de software a la medida',
    color: 'violet',
    cuentas: ['correo-itech', 'correo-itech-alterno', 'itech'],
    activa: true,
    orden: 0,
    actualizadoEn: AHORA_INICIAL
  },
  {
    id: 'dealer-solutions',
    nombre: 'Dealer Solutions',
    descripcion: 'software para agencias automotrices',
    color: 'cyan',
    cuentas: ['correo-dealer'],
    activa: true,
    orden: 1,
    actualizadoEn: AHORA_INICIAL
  },
  {
    id: 'nexusqtech',
    nombre: 'NexusQTech',
    descripcion: 'integraciones y tecnologia para grupos automotrices',
    color: 'emerald',
    cuentas: ['correo-nexus', 'correo-outlook'],
    activa: true,
    orden: 2,
    actualizadoEn: AHORA_INICIAL
  },
  {
    id: 'operativai',
    nombre: 'OperativAI',
    descripcion: 'agentes de IA',
    color: 'orange',
    cuentas: [],
    activa: true,
    orden: 3,
    actualizadoEn: AHORA_INICIAL
  }
];

// --- El catalogo vigente, para quien arma prompts sin tener los datos ------

let fuenteCatalogo: () => Empresa[] = () => EMPRESAS_INICIALES;

/** rutas.ts engancha aqui el almacen; lo demas lee siempre lo vigente. */
export function establecerCatalogo(fn: () => Empresa[]): void {
  fuenteCatalogo = fn;
}

/** Todas, activas e inactivas, en su orden. */
export function catalogoEmpresas(): Empresa[] {
  return ordenar(fuenteCatalogo());
}

/** Las que se ofrecen en selectores y al modelo. */
export function empresasActivas(): Empresa[] {
  return catalogoEmpresas().filter((e) => e.activa);
}

export function ordenar(lista: Empresa[]): Empresa[] {
  return [...lista].sort((a, b) => a.orden - b.orden);
}

// --- Texto para los prompts ------------------------------------------------

const NUMEROS = [
  'cero',
  'una',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez'
];

/**
 * La primera frase de todos los prompts: quienes somos. Se arma con las
 * empresas activas para que el modelo conozca a las nuevas y olvide a las
 * dadas de baja.
 */
export function contextoEmpresas(
  empresas: Empresa[] = empresasActivas()
): string {
  const cierre = 'Escribes en español de México, directo y sin adornos.';
  const activas = empresas.filter((e) => e.activa);
  if (activas.length === 0) {
    return `Trabajas para un grupo de empresas. ${cierre}`;
  }
  const partes = activas.map((e) =>
    e.descripcion ? `${e.nombre} (${e.descripcion})` : e.nombre
  );
  const lista =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  if (activas.length === 1) {
    return `Trabajas para una empresa: ${lista}. ${cierre}`;
  }
  const cuantas = NUMEROS[activas.length] ?? String(activas.length);
  return `Trabajas para un grupo con ${cuantas} empresas: ${lista}. ${cierre}`;
}

/** `"Itech Dev|Dealer Solutions|…|null"`, para el JSON que se le pide al modelo. */
export function opcionesEmpresa(
  empresas: Empresa[] = empresasActivas()
): string {
  return [
    ...empresas.filter((e) => e.activa).map((e) => e.nombre),
    'null'
  ].join('|');
}

/** El nombre tal como esta en el catalogo, si lo que dijo el modelo es una empresa. */
export function empresaValida(
  valor: unknown,
  empresas: Empresa[] = empresasActivas()
): string | undefined {
  if (typeof valor !== 'string' || !valor.trim()) {
    return undefined;
  }
  const clave = claveNombre(valor);
  return empresas.find((e) => claveNombre(e.nombre) === clave)?.nombre;
}

/**
 * La empresa a la que pertenece un buzon: la que lo tenga en `cuentas`. Si
 * ninguna lo reclama se cae a las pistas de siempre en el identificador
 * (itech, dealer, nexus/outlook, operativ), para no perder lo que ya
 * funcionaba con los buzones viejos.
 */
export function empresaDeCuenta(
  accountId: string,
  empresas: Empresa[] = catalogoEmpresas()
): string | undefined {
  const id = accountId.trim().toLowerCase();
  const propia = ordenar(empresas).find((e) =>
    e.cuentas.some((c) => c.toLowerCase() === id)
  );
  if (propia) {
    return propia.nombre;
  }
  const porPista = (pistas: string[], nombre: string) =>
    pistas.some((p) => id.includes(p))
      ? empresaValida(
          nombre,
          empresas.filter((e) => e.activa)
        )
      : undefined;
  return (
    porPista(['itech'], 'Itech Dev') ??
    porPista(['dealer'], 'Dealer Solutions') ??
    porPista(['nexus', 'outlook'], 'NexusQTech') ??
    porPista(['operativ'], 'OperativAI')
  );
}

/**
 * Sin modelo, la empresa que menciona un texto dictado o el titulo de una
 * junta: el nombre completo, o su primera palabra ("Itech", "Dealer") y, en
 * los nombres pegados (NexusQTech, OperativAI), el primer trozo como prefijo.
 */
export function empresaPorPalabra(
  texto: string,
  empresas: Empresa[] = empresasActivas()
): string | undefined {
  const plano = sinAcentos(texto);
  for (const e of ordenar(empresas).filter((x) => x.activa)) {
    if (patronesDe(e.nombre).some((re) => re.test(plano))) {
      return e.nombre;
    }
  }
  return undefined;
}

function patronesDe(nombre: string): RegExp[] {
  const plano = sinAcentos(nombre).trim();
  const patrones = [new RegExp(`\\b${escapar(plano)}\\b`)];
  const palabras = plano.split(/\s+/).filter(Boolean);
  const primera = palabras[0] ?? '';
  if (palabras.length > 1) {
    if (primera.length >= 5) {
      patrones.push(new RegExp(`\\b${escapar(primera)}\\b`));
    }
  } else {
    // "NexusQTech" → "nexus", "OperativAI" → "operativ" (trozo antes de la mayuscula).
    const trozo = sinAcentos(
      nombre.trim().split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)[0] ??
        ''
    );
    if (trozo.length >= 4 && trozo.length < plano.length) {
      patrones.push(new RegExp(`\\b${escapar(trozo)}`));
    }
  }
  return patrones;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// --- Validacion de lo que manda el portal ----------------------------------

/** Minusculas, sin acentos ni espacios dobles: asi se comparan los nombres. */
export function claveNombre(nombre: string): string {
  return sinAcentos(nombre).replace(/\s+/g, ' ').trim();
}

/** Un id estable a partir del nombre; no cambia aunque el nombre cambie. */
export function idDeEmpresa(nombre: string): string {
  return (
    sinAcentos(nombre)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'empresa'
  );
}

export function validarEmpresa(
  crudo: unknown,
  previa: Empresa | undefined,
  ahora: string,
  orden = previa?.orden ?? 0
): Empresa {
  const e = (crudo ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const nombre = texto(e['nombre']);
  if (!nombre) {
    throw new Error('Cada empresa necesita un nombre.');
  }
  const color = texto(e['color'])?.toLowerCase();
  if (color && !/^[a-z]{3,20}$/.test(color)) {
    throw new Error(`El color de "${nombre}" no es válido.`);
  }
  const cuentas = Array.isArray(e['cuentas'])
    ? [
        ...new Set(
          (e['cuentas'] as unknown[])
            .map((c) => (typeof c === 'string' ? c.trim() : ''))
            .filter(Boolean)
        )
      ]
    : (previa?.cuentas ?? []);
  const sinCambios =
    previa &&
    previa.nombre === nombre.slice(0, 60) &&
    (previa.descripcion ?? undefined) ===
      texto(e['descripcion'])?.slice(0, 300) &&
    (previa.color ?? undefined) === color &&
    previa.cuentas.join('|') === cuentas.join('|') &&
    previa.activa === (e['activa'] !== false);
  return {
    id: texto(e['id']) ?? previa?.id ?? idDeEmpresa(nombre),
    nombre: nombre.slice(0, 60),
    descripcion: texto(e['descripcion'])?.slice(0, 300),
    color,
    cuentas,
    activa: e['activa'] !== false,
    orden,
    actualizadoEn: previa && sinCambios ? previa.actualizadoEn : ahora
  };
}

/**
 * La lista completa tal como la manda el portal: valida cada renglon,
 * conserva los ids que ya existian, numera el orden como viene, y no deja
 * dos empresas con el mismo nombre ni un buzon en dos empresas.
 */
export function validarCatalogo(
  crudos: unknown[],
  previas: Empresa[],
  ahora: string
): Empresa[] {
  const limpias = crudos.map((crudo, i) => {
    const id = (crudo as { id?: unknown } | null)?.id;
    const previa =
      typeof id === 'string' ? previas.find((p) => p.id === id) : undefined;
    return validarEmpresa(crudo, previa, ahora, i);
  });
  const ids = new Set<string>();
  const nombres = new Map<string, string>();
  const buzones = new Map<string, string>();
  for (const e of limpias) {
    while (ids.has(e.id)) {
      e.id = `${e.id}-2`;
    }
    ids.add(e.id);
    const clave = claveNombre(e.nombre);
    const repetida = nombres.get(clave);
    if (repetida) {
      throw new Error(
        `"${e.nombre}" y "${repetida}" son la misma empresa: cada una necesita un nombre distinto.`
      );
    }
    nombres.set(clave, e.nombre);
    for (const c of e.cuentas) {
      const duena = buzones.get(c.toLowerCase());
      if (duena && duena !== e.nombre) {
        throw new Error(
          `El buzón "${c}" está en "${duena}" y en "${e.nombre}"; un buzón pertenece a una sola empresa.`
        );
      }
      buzones.set(c.toLowerCase(), e.nombre);
    }
  }
  return limpias;
}

// --- Renombrar: reetiquetar lo ya guardado ---------------------------------

export interface DatosConEmpresa {
  registroCorreo: Registro;
  anotaciones: Anotaciones;
  personales: TaskItem[];
  aprendido: Aprendizajes;
}

/**
 * Cambia `company` de `de` a `a` en todo lo guardado: los pendientes del
 * correo, los personales, las ediciones a mano (anotaciones.cambios) y lo
 * aprendido por remitente. Es pura: devuelve copias nuevas solo de lo que
 * cambio y cuantos registros toco.
 */
export function renombrarEmpresa(
  datos: DatosConEmpresa,
  de: string,
  a: string
): { datos: DatosConEmpresa; tocados: number } {
  const clave = claveNombre(de);
  const es = (v: unknown) => typeof v === 'string' && claveNombre(v) === clave;
  let tocados = 0;
  let registroCorreo = datos.registroCorreo;
  let cambioRegistro = false;
  const nuevoRegistro: Registro = {};
  for (const [cuenta, lista] of Object.entries(datos.registroCorreo)) {
    let cambio = false;
    const nueva = lista.map((t) => {
      if (!es(t.company)) {
        return t;
      }
      cambio = true;
      tocados++;
      return { ...t, company: a };
    });
    // La cuenta que no cambio conserva su misma lista (nada que reescribir).
    nuevoRegistro[cuenta] = cambio ? nueva : lista;
    cambioRegistro ||= cambio;
  }
  if (cambioRegistro) {
    registroCorreo = nuevoRegistro;
  }
  let personales = datos.personales;
  if (personales.some((t) => es(t.company))) {
    personales = personales.map((t) => {
      if (!es(t.company)) {
        return t;
      }
      tocados++;
      return { ...t, company: a };
    });
  }
  let anotaciones = datos.anotaciones;
  const entradas = Object.entries(datos.anotaciones).filter(([, n]) =>
    es(n.cambios?.company)
  );
  if (entradas.length > 0) {
    anotaciones = { ...datos.anotaciones };
    for (const [id, n] of entradas) {
      anotaciones[id] = { ...n, cambios: { ...n.cambios, company: a } };
      tocados++;
    }
  }
  let aprendido = datos.aprendido;
  const remitentes = Object.entries(datos.aprendido).filter(([, r]) =>
    es(r.company)
  );
  if (remitentes.length > 0) {
    aprendido = { ...datos.aprendido };
    for (const [remitente, r] of remitentes) {
      aprendido[remitente] = { ...r, company: a };
      tocados++;
    }
  }
  return {
    datos: { registroCorreo, anotaciones, personales, aprendido },
    tocados
  };
}

/** Cuantos pendientes abiertos (no hechos, no borrados) llevan esa empresa. */
export function pendientesAbiertosDe(
  nombre: string,
  tareas: TaskItem[]
): number {
  const clave = claveNombre(nombre);
  return tareas.filter(
    (t) =>
      t.status !== 'hecho' &&
      typeof t.company === 'string' &&
      claveNombre(t.company) === clave
  ).length;
}
