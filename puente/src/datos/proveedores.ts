import type { Proveedor, TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from '../pendientes/anotaciones.js';
import type { Registro } from '../pendientes/registro.js';

export type { Proveedor };

/**
 * El catalogo de proveedores y clientes externos.
 *
 * Antes Vanguardia, Birdom y AutoDeal estaban fijos en el dictado; ahora se
 * capturan desde Integraciones → Proveedores y de aqui salen los selectores
 * del portal, los filtros y el contexto que se le da al modelo. La primera
 * vez que el puente arranca con la lista vacia se siembran esos tres.
 *
 * El nombre es la llave con la que se etiquetan los pendientes (`project`),
 * asi que al renombrar un proveedor se reetiqueta lo ya guardado.
 */

const AHORA_INICIAL = '2026-01-01T00:00:00.000Z';

export const PROVEEDORES_INICIALES: Proveedor[] = [
  {
    id: 'vanguardia',
    nombre: 'Vanguardia',
    descripcion: 'grupo automotriz',
    color: 'sky',
    activa: true,
    orden: 0,
    actualizadoEn: AHORA_INICIAL
  },
  {
    id: 'birdom',
    nombre: 'Birdom',
    descripcion: 'operaciones y producto',
    color: 'rose',
    activa: true,
    orden: 1,
    actualizadoEn: AHORA_INICIAL
  },
  {
    id: 'autodeal',
    nombre: 'AutoDeal',
    descripcion: 'agencias automotrices',
    color: 'amber',
    activa: true,
    orden: 2,
    actualizadoEn: AHORA_INICIAL
  }
];

// --- El catalogo vigente, para quien arma prompts sin tener los datos ------

let fuenteCatalogo: () => Proveedor[] = () => PROVEEDORES_INICIALES;

/** rutas.ts engancha aqui el almacen; lo demas lee siempre lo vigente. */
export function establecerCatalogoProveedores(fn: () => Proveedor[]): void {
  fuenteCatalogo = fn;
}

/** Todas, activas e inactivas, en su orden. */
export function catalogoProveedores(): Proveedor[] {
  return ordenar(fuenteCatalogo());
}

/** Las que se ofrecen en selectores y al modelo. */
export function proveedoresActivos(): Proveedor[] {
  return catalogoProveedores().filter((p) => p.activa);
}

export function ordenarProveedores(lista: Proveedor[]): Proveedor[] {
  return [...lista].sort((a, b) => a.orden - b.orden);
}

function ordenar(lista: Proveedor[]): Proveedor[] {
  return ordenarProveedores(lista);
}

// --- Texto para los prompts ------------------------------------------------

const NUMEROS = [
  'cero',
  'uno',
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
 * Quienes son los clientes y proveedores externos. Se arma con los activos
 * para que el modelo conozca a los nuevos y olvide a los dados de baja.
 */
export function contextoProveedores(
  proveedores: Proveedor[] = proveedoresActivos()
): string {
  const activos = proveedores.filter((p) => p.activa);
  if (activos.length === 0) {
    return 'No hay clientes ni proveedores externos capturados.';
  }
  const partes = activos.map((p) =>
    p.descripcion ? `${p.nombre} (${p.descripcion})` : p.nombre
  );
  const lista =
    partes.length === 1
      ? partes[0]
      : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
  if (activos.length === 1) {
    return `El cliente o proveedor externo es ${lista}.`;
  }
  const cuantos = NUMEROS[activos.length] ?? String(activos.length);
  return `Los clientes y proveedores externos son ${cuantos}: ${lista}.`;
}

/** `"Vanguardia|Birdom|…|null"`, para el JSON que se le pide al modelo. */
export function opcionesProveedor(
  proveedores: Proveedor[] = proveedoresActivos()
): string {
  return [
    ...proveedores.filter((p) => p.activa).map((p) => p.nombre),
    'null'
  ].join('|');
}

/** El nombre tal como esta en el catalogo, si lo que dijo el modelo es un proveedor. */
export function proveedorValido(
  valor: unknown,
  proveedores: Proveedor[] = proveedoresActivos()
): string | undefined {
  if (typeof valor !== 'string' || !valor.trim()) {
    return undefined;
  }
  const clave = claveNombre(valor);
  return proveedores.find((p) => claveNombre(p.nombre) === clave)?.nombre;
}

/**
 * Palabras que no identifican a nadie: si el nombre empieza con una de
 * estas, solo cuenta el nombre completo.
 */
const PALABRAS_GENERICAS = new Set([
  'total',
  'grupo',
  'nuevo',
  'nueva',
  'sistema',
  'soluciones',
  'servicios',
  'global',
  'general',
  'digital',
  'tecnologia',
  'software',
  'empresa',
  'negocio',
  'ventas',
  'mexico',
  'auto',
  'cliente',
  'proveedor'
]);

/**
 * Sin modelo, el proveedor que menciona un texto dictado: el nombre completo
 * siempre; la primera palabra suelta solo si tiene 5 letras o mas y no es
 * generica; y en los nombres pegados (AutoDeal), el primer trozo como
 * prefijo si no es generico.
 */
export function proveedorPorPalabra(
  texto: string,
  proveedores: Proveedor[] = proveedoresActivos()
): string | undefined {
  const plano = sinAcentos(texto);
  for (const p of ordenar(proveedores).filter((x) => x.activa)) {
    if (patronesDe(p.nombre).some((re) => re.test(plano))) {
      return p.nombre;
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
    if (primera.length >= 5 && !PALABRAS_GENERICAS.has(primera)) {
      patrones.push(new RegExp(`\\b${escapar(primera)}\\b`));
    }
  } else {
    const trozo = sinAcentos(
      nombre.trim().split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)[0] ??
        ''
    );
    if (
      trozo.length >= 4 &&
      trozo.length < plano.length &&
      !PALABRAS_GENERICAS.has(trozo)
    ) {
      patrones.push(new RegExp(`\\b${escapar(trozo)}`));
    }
  }
  return patrones;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// --- Validacion de lo que manda el portal ----------------------------------

/** Minusculas, sin acentos ni espacios dobles: asi se comparan los nombres. */
export function claveNombreProveedor(nombre: string): string {
  return claveNombre(nombre);
}

function claveNombre(nombre: string): string {
  return sinAcentos(nombre).replace(/\s+/g, ' ').trim();
}

/** Un id estable a partir del nombre; no cambia aunque el nombre cambie. */
export function idDeProveedor(nombre: string): string {
  return (
    sinAcentos(nombre)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'proveedor'
  );
}

export function validarProveedor(
  crudo: unknown,
  previa: Proveedor | undefined,
  ahora: string,
  orden = previa?.orden ?? 0
): Proveedor {
  const p = (crudo ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const nombre = texto(p['nombre']);
  if (!nombre) {
    throw new Error('Cada proveedor necesita un nombre.');
  }
  const color = texto(p['color'])?.toLowerCase();
  if (color && !/^[a-z]{3,20}$/.test(color)) {
    throw new Error(`El color de "${nombre}" no es válido.`);
  }
  const sinCambios =
    previa &&
    previa.nombre === nombre.slice(0, 60) &&
    (previa.descripcion ?? undefined) ===
      texto(p['descripcion'])?.slice(0, 300) &&
    (previa.color ?? undefined) === color &&
    previa.activa === (p['activa'] !== false);
  return {
    id: texto(p['id']) ?? previa?.id ?? idDeProveedor(nombre),
    nombre: nombre.slice(0, 60),
    descripcion: texto(p['descripcion'])?.slice(0, 300),
    color,
    activa: p['activa'] !== false,
    orden,
    actualizadoEn: previa && sinCambios ? previa.actualizadoEn : ahora
  };
}

/**
 * La lista completa tal como la manda el portal: valida cada renglon,
 * conserva los ids que ya existian, numera el orden como viene, y no deja
 * dos proveedores con el mismo nombre.
 */
export function validarCatalogoProveedores(
  crudos: unknown[],
  previas: Proveedor[],
  ahora: string
): Proveedor[] {
  const limpios = crudos.map((crudo, i) => {
    const id = (crudo as { id?: unknown } | null)?.id;
    const previa =
      typeof id === 'string' ? previas.find((x) => x.id === id) : undefined;
    return validarProveedor(crudo, previa, ahora, i);
  });
  const ids = new Set<string>();
  const nombres = new Map<string, string>();
  for (const p of limpios) {
    while (ids.has(p.id)) {
      p.id = `${p.id}-2`;
    }
    ids.add(p.id);
    const clave = claveNombre(p.nombre);
    const repetido = nombres.get(clave);
    if (repetido) {
      throw new Error(
        `"${p.nombre}" y "${repetido}" son el mismo proveedor: cada uno necesita un nombre distinto.`
      );
    }
    nombres.set(clave, p.nombre);
  }
  return limpios;
}

// --- Renombrar: reetiquetar lo ya guardado ---------------------------------

export interface DatosConProveedor {
  registroCorreo: Registro;
  anotaciones: Anotaciones;
  personales: TaskItem[];
}

/**
 * Cambia `project` de `de` a `a` en todo lo guardado: los pendientes del
 * correo, los personales y las ediciones a mano (anotaciones.cambios). Es
 * pura: devuelve copias nuevas solo de lo que cambio y cuantos registros
 * toco.
 */
export function renombrarProveedor(
  datos: DatosConProveedor,
  de: string,
  a: string
): { datos: DatosConProveedor; tocados: number } {
  const clave = claveNombre(de);
  const es = (v: unknown) => typeof v === 'string' && claveNombre(v) === clave;
  let tocados = 0;
  let registroCorreo = datos.registroCorreo;
  let cambioRegistro = false;
  const nuevoRegistro: Registro = {};
  for (const [cuenta, lista] of Object.entries(datos.registroCorreo)) {
    let cambio = false;
    const nueva = lista.map((t) => {
      if (!es(t.project)) {
        return t;
      }
      cambio = true;
      tocados++;
      return { ...t, project: a };
    });
    nuevoRegistro[cuenta] = cambio ? nueva : lista;
    cambioRegistro ||= cambio;
  }
  if (cambioRegistro) {
    registroCorreo = nuevoRegistro;
  }
  let personales = datos.personales;
  if (personales.some((t) => es(t.project))) {
    personales = personales.map((t) => {
      if (!es(t.project)) {
        return t;
      }
      tocados++;
      return { ...t, project: a };
    });
  }
  let anotaciones = datos.anotaciones;
  const entradas = Object.entries(datos.anotaciones).filter(([, n]) =>
    es(n.cambios?.project)
  );
  if (entradas.length > 0) {
    anotaciones = { ...datos.anotaciones };
    for (const [id, n] of entradas) {
      anotaciones[id] = { ...n, cambios: { ...n.cambios, project: a } };
      tocados++;
    }
  }
  return {
    datos: { registroCorreo, anotaciones, personales },
    tocados
  };
}

/** Cuantos pendientes abiertos (no hechos, no borrados) llevan ese proveedor. */
export function pendientesAbiertosDeProveedor(
  nombre: string,
  tareas: TaskItem[]
): number {
  const clave = claveNombre(nombre);
  return tareas.filter(
    (t) =>
      t.status !== 'hecho' &&
      typeof t.project === 'string' &&
      claveNombre(t.project) === clave
  ).length;
}
