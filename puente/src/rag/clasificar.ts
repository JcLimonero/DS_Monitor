import { normalizarTexto } from '../proveedores/fireflies.js';

/**
 * Sensibilidad de un documento del RAG.
 *
 * - `general`: lo puede ver quien tenga acceso a la empresa y al proyecto.
 * - `costos`: precios y cotizaciones. Solo lo ven los permisos de costos.
 *
 * La marca vive en el documento y se copia a cada fragmento
 * (rag_documentos.sensibilidad y rag_fragmentos.sensibilidad).
 */
export type Sensibilidad = 'general' | 'costos';

/**
 * Carpetas de Drive cuyo contenido son precios. Se comparan normalizadas
 * (normalizarTexto trata el guion bajo como espacio: `04_Costos` es `04 costos`).
 * Mandan sobre todo lo demas: ningun frontmatter las baja a general.
 */
export const CARPETAS_COSTOS: readonly string[] = [
  '04 costos',
  '01 cotizaciones'
];

/**
 * Lista blanca: las unicas carpetas que, por si solas, hacen general a un
 * documento. Cualquier otra ubicacion es costos.
 */
export const CARPETAS_GENERALES: readonly string[] = [
  'juntas',
  '02 proyecto',
  '03 entregables'
];

/**
 * Capa extra contra nombres de precios sin la carpeta numerada: si una de
 * estas raices aparece en CUALQUIER segmento de la ruta (carpetas o archivo),
 * normalizado y sin acentos, el documento es costos aunque cuelgue de una
 * carpeta de la lista blanca. Cubre COTIZACION_x.md dentro de 02_Proyecto y
 * carpetas viejas como `Cotizaciones` o `1_Cotizaciones`.
 */
const RAICES_DE_COSTOS: readonly string[] = [
  'cotiza',
  'costo',
  'precio',
  'presupuest',
  'propuesta econom'
];

/** Lo que el texto crudo declara en `sensibilidad`. */
export type DeclaracionSensibilidad = 'ninguna' | 'general' | 'otra';

const LINEAS_A_REVISAR = 60;
const LLAVE_SENSIBILIDAD = /^\s*["']?sensibilidad["']?\s*:(.*)$/i;

/**
 * Lee la sensibilidad declarada directo del TEXTO CRUDO del markdown, sin
 * pasar por el frontmatter ya interpretado: un frontmatter que no empieza en
 * el primer byte, que no cierra, que cierra con `...`, que va en un bloque
 * ```yaml, que usa solo CR o que repite la llave se leeria distinto (o no se
 * leeria) segun el analizador, y aqui no puede quedar nada sin leer.
 *
 * Revisa las primeras 60 lineas (sin BOM, con CRLF y CR como salto) buscando
 * `sensibilidad:` sin distinguir mayusculas ni comillas en la llave.
 * - `ninguna`: no aparece.
 * - `general`: aparece UNA vez y su valor es exactamente `general` (sin
 *   comillas ni espacios, sin distinguir mayusculas).
 * - `otra`: todo lo demas: `costos`, un valor desconocido, vacio, una lista,
 *   o la llave repetida (aunque una de las dos diga general).
 */
export function declaracionDeSensibilidad(
  markdown: string | undefined
): DeclaracionSensibilidad {
  if (!markdown) {
    return 'ninguna';
  }
  const lineas = markdown
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n', LINEAS_A_REVISAR);
  const valores: string[] = [];
  for (const linea of lineas) {
    const m = LLAVE_SENSIBILIDAD.exec(linea);
    if (m) {
      valores.push(
        (m[1] ?? '')
          .trim()
          .replace(/^["']|["']$/g, '')
          .trim()
          .toLowerCase()
      );
    }
  }
  if (valores.length === 0) {
    return 'ninguna';
  }
  return valores.length === 1 && valores[0] === 'general' ? 'general' : 'otra';
}

export interface EntradaClasificacion {
  /** Ruta del archivo en Drive. Sin ruta no se puede saber: falla cerrado. */
  ruta?: string;
  /** El markdown completo, tal como llego (de ahi se lee `sensibilidad`). */
  markdown?: string;
}

/**
 * Decide la sensibilidad de un documento. Es una lista blanca: `general` hay
 * que ganarselo y todo lo demas es `costos`. En orden:
 *
 * 1. Sin ruta: `costos` (no se puede comprobar el paso 3).
 * 2. El texto declara `sensibilidad` con algo que no es `general` (o la
 *    repite): `costos`.
 * 3. Un segmento de la ruta es `04_Costos` o `01_Cotizaciones`: `costos`, y
 *    nada lo baja, ni siquiera `sensibilidad: general`.
 * 4. `sensibilidad: general` explicito (una sola vez): `general`. Es lo unico
 *    que anula los pasos 5 y 6.
 * 5. Algun segmento de la ruta (carpeta o archivo) contiene una raiz de
 *    precios (cotiza, costo, precio, presupuest, propuesta econom): `costos`.
 * 6. Alguna CARPETA de la ruta (no el nombre del archivo) es `Juntas`,
 *    `02_Proyecto` o `03_Entregables`: `general`.
 * 7. Cualquier otra cosa (fichas CLIENTE.md y PROYECTO_*.md, brand kits,
 *    carpetas sin numero, etc.): `costos`.
 */
export function clasificarSensibilidad(
  entrada: EntradaClasificacion
): Sensibilidad {
  const segmentos = segmentosDe(entrada.ruta);
  if (segmentos.length === 0) {
    return 'costos';
  }
  const declarada = declaracionDeSensibilidad(entrada.markdown);
  if (declarada === 'otra') {
    return 'costos';
  }
  const normalizados = segmentos.map((s) => normalizarTexto(s));
  if (normalizados.some((s) => CARPETAS_COSTOS.includes(s))) {
    return 'costos';
  }
  if (declarada === 'general') {
    return 'general';
  }
  if (normalizados.some(esNombreDeCostos)) {
    return 'costos';
  }
  const carpetas = normalizados.slice(0, -1);
  return carpetas.some((s) => CARPETAS_GENERALES.includes(s))
    ? 'general'
    : 'costos';
}

function segmentosDe(ruta: string | undefined): string[] {
  return (ruta ?? '').split(/[/\\]+/).filter((s) => s.trim() !== '');
}

/** El segmento (ya normalizado) trae una raiz de precios, tambien pegada sin espacios. */
function esNombreDeCostos(normalizado: string): boolean {
  const pegado = normalizado.replace(/ /g, '');
  return RAICES_DE_COSTOS.some(
    (raiz) =>
      normalizado.includes(raiz) || pegado.includes(raiz.replace(/ /g, ''))
  );
}
