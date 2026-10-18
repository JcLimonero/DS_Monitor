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
 * Raices de nombres de precios. Si una aparece en CUALQUIER segmento de la
 * ruta (carpetas o nombre del archivo), normalizado y sin acentos, el
 * documento es costos aunque cuelgue de una carpeta de la lista blanca. Cubre
 * COTIZACION_x.md dentro de 02_Proyecto, `Tarifas.md`, `Plan_de_pagos.md`,
 * carpetas viejas como `Cotizaciones` o `1_Cotizaciones`, y los nombres en
 * ingles (`Pricing`, `Quote_x`, `Budget`).
 *
 * Son subcadenas, no palabras completas, a proposito: `cost` cubre costo,
 * costos y cost; `monto` cubre montos; `pago` cubre pagos. Dan falsos
 * positivos (Costa Rica, Montoya, apagado): un cliente o carpeta con ese
 * nombre queda en costos. Es el precio de no dejar pasar un archivo con
 * precios. Las raices de varias palabras tambien se buscan pegadas
 * (`PropuestaEconomica`).
 *
 * Solo un `sensibilidad: general` valido (ver declaracionDeSensibilidad) las
 * anula; nunca a las carpetas de CARPETAS_COSTOS.
 */
export const RAICES_DE_COSTOS: readonly string[] = [
  'cotiza',
  'cost',
  'precio',
  'price',
  'pricing',
  'presupuest',
  'budget',
  'quote',
  'tarifa',
  'honorario',
  'monto',
  'pago',
  'propuesta econom',
  'propuesta comercial',
  // Raices amplias (decision de Carlos, 2026-10-17): atrapan Propuesta_firmada.md,
  // Oferta.md e Inversion.md. Costo conocido: las propuestas tecnicas y otros
  // documentos con esas palabras quedan en `costos` hasta marcarlos `general`.
  'propuesta',
  'oferta',
  'inversion'
];

/**
 * Cifras de dinero en el texto del documento. Heuristica CONSERVADORA: una
 * sola coincidencia basta para que un documento de la lista blanca pase a
 * costos. Se esperan falsos positivos (una junta que solo menciona un monto
 * queda en costos hasta que se marque `sensibilidad: general`).
 *
 * Se aplican sobre el texto ya plegado (ver plegar): sin acentos, en
 * minusculas y con los caracteres de ancho completo en su forma normal.
 * - `$` (o `euro`, `libra`, `yen`) seguido de un digito, con o sin espacios, o un
 *   digito seguido de esos simbolos: `$1,200`, `$ 1200`, `US$ 5`.
 * - Las palabras completas MXN, USD, EUR e IVA (`+IVA`, `+ IVA`, `iva_16`), e I.V.A.
 * - Un numero seguido de pesos, dolares o euros, con `mil`, `millones` (de) o `k`
 *   opcionales: `1,200 pesos`, `10 mil pesos`, `3 millones de pesos`.
 *
 * Sin retroceso catastrofico: cada patron ancla su inicio (`$`, un limite de
 * palabra o el comienzo de una racha de digitos) y los cuantificadores van
 * sobre clases que no se solapan con lo que sigue.
 */
export const PATRONES_DE_DINERO: readonly RegExp[] = [
  /[$\u20AC\u00A3\u00A5]\s*\d|\d\s*[\u20AC\u00A3\u00A5]/i,
  /(?<![a-z0-9])(?:mxn|usd|eur|iva)(?![a-z0-9])/i,
  /(?<![a-z0-9])i\.\s?v\.\s?a(?![a-z0-9])/i,
  /(?<![\d.,])\d[\d.,]*\s*(?:(?:mil|millon|millones|k)\s*(?:de\s+)?)?(?:pesos|d[o\u00F3]lares|euros)(?![a-z])/i
];

/** Los patrones de dinero en uno solo: un unico recorrido por documento. */
const DINERO = new RegExp(
  PATRONES_DE_DINERO.map((patron) => `(?:${patron.source})`).join('|'),
  'i'
);

/** Lo que el texto crudo declara en `sensibilidad`. */
export type DeclaracionSensibilidad = 'ninguna' | 'general' | 'otra';

/**
 * Cualquier cosa que parezca `sensibilidad: <valor>` en el texto plegado:
 * `**Sensibilidad:** costos`, `> sensibilidad: costos`, `<b>Sensibilidad</b>: x`,
 * `sensibilidad = costos`, dentro de un bloque de codigo, a mitad de linea.
 * Captura el resto de la linea como valor.
 */
const LLAVE_SENSIBILIDAD =
  /(?<![a-z0-9_])sensibilidad(?:[^a-z0-9\n:=<]|<\/?[a-z]{1,6}>){0,8}[:=]([^\n]*)/gi;

/** La unica forma de `general` que vale: llave en columna 0, sin adornos. */
const GENERAL_VALIDO =
  /^(["']?)sensibilidad\1[ \t]*:[ \t]*(["']?)general\2[ \t]*$/i;
const DELIMITADOR = /^---[ \t]*$/;
const VALOR_GENERAL = /^(?:general|"general"|'general')$/;

/** Lo que se quita de los lados del valor: enfasis de markdown y espacios. */
const ADORNOS = /^[\s*_`~]+|[\s*_`~]+$/g;

const MARCAS = /[\u0300-\u036F]/g;
const INVISIBLES = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const SALTOS = /\r\n?|[\u2028\u2029\u0085\u000B\u000C]/g;

/** Letras cirilicas, armenias y griegas que se ven como las latinas de `sensibilidad`. */
const HOMOGLIFOS: Record<string, string> = {
  '\u0430': 'a',
  '\u0435': 'e',
  '\u0456': 'i',
  '\u0455': 's',
  '\u0501': 'd',
  '\u04CF': 'l',
  '\u0578': 'n',
  '\u03BF': 'o',
  '\u03B9': 'i'
};
const HOMOGLIFOS_RE = new RegExp(`[${Object.keys(HOMOGLIFOS).join('')}]`, 'g');

/**
 * Deja el texto en una forma comparable: saltos de linea unificados,
 * compatibilidad Unicode (ancho completo), sin acentos ni caracteres
 * invisibles, en minusculas y sin las letras de otros alfabetos que se
 * parecen a las latinas de `sensibilidad`. Un solo recorrido por paso.
 */
function plegar(texto: string): string {
  return texto
    .replace(SALTOS, '\n')
    .normalize('NFKD')
    .replace(MARCAS, '')
    .replace(INVISIBLES, '')
    .toLowerCase()
    .replace(HOMOGLIFOS_RE, (letra) => HOMOGLIFOS[letra] ?? letra);
}

/**
 * Lee la sensibilidad declarada directo del TEXTO CRUDO del markdown, sin
 * pasar por el frontmatter ya interpretado.
 *
 * Para `costos` es estricta: CUALQUIER linea de todo el documento que parezca
 * `sensibilidad: <valor>` (en el frontmatter, en el cuerpo, en un bloque de
 * codigo, con enfasis, citada o con la llave repetida) cuenta. Si alguna trae
 * un valor que no sea exactamente `general` (sin importar mayusculas), o si
 * la llave aparece mas de una vez, la declaracion es `otra`.
 * Una llave disfrazada (con acentos, en ancho completo, con caracteres
 * invisibles o con letras cirilicas) tambien cuenta, y siempre como `otra`.
 *
 * Para `general` es estricta al reves: solo vale si aparece UNA vez en todo el
 * documento y esa vez es una linea `sensibilidad: general` (columna 0, sin
 * adornos ni comentarios; comillas solo en pareja) dentro de un frontmatter
 * valido: el documento empieza en el primer byte (se permite BOM) con una
 * linea `---` y el bloque cierra con otra linea `---`. Un `general` en el
 * cuerpo, en un bloque de codigo, en un frontmatter que no empieza en el
 * primer byte o que no cierra con `---` no libera nada (`ninguna`).
 */
export function declaracionDeSensibilidad(
  markdown: string | undefined
): DeclaracionSensibilidad {
  if (!markdown || !plegar(markdown).includes('sensibilidad')) {
    return 'ninguna';
  }
  let total = 0;
  let todasGeneral = true;
  for (const linea of markdown.replace(SALTOS, '\n').split('\n')) {
    const plegadas = [...plegar(linea).matchAll(LLAVE_SENSIBILIDAD)];
    if (plegadas.length === 0) {
      continue;
    }
    total += plegadas.length;
    // Lo que solo aparece al plegar (acentos, ancho completo, caracteres
    // invisibles, letras de otro alfabeto) es una llave disfrazada: no hay
    // forma de darla por un `general` exacto.
    const crudas = [...linea.matchAll(LLAVE_SENSIBILIDAD)];
    if (crudas.length !== plegadas.length) {
      todasGeneral = false;
      continue;
    }
    for (const m of crudas) {
      const valor = (m[1] ?? '').replace(ADORNOS, '').toLowerCase();
      todasGeneral &&= VALOR_GENERAL.test(valor);
    }
  }
  if (total === 0) {
    return 'ninguna';
  }
  if (total > 1 || !todasGeneral) {
    return 'otra';
  }
  return generalEnFrontmatterValido(markdown) ? 'general' : 'ninguna';
}

/** El documento tiene un frontmatter valido con exactamente una linea `sensibilidad: general`. */
function generalEnFrontmatterValido(markdown: string): boolean {
  const lineas = markdown
    .replace(/^\uFEFF/, '')
    .replace(SALTOS, '\n')
    .split('\n');
  if (!DELIMITADOR.test(lineas[0] ?? '')) {
    return false;
  }
  const cierre = lineas.findIndex((l, i) => i > 0 && DELIMITADOR.test(l));
  if (cierre < 0) {
    return false;
  }
  return (
    lineas.slice(1, cierre).filter((l) => GENERAL_VALIDO.test(l)).length === 1
  );
}

/** El texto trae cifras de dinero (ver PATRONES_DE_DINERO). */
export function contieneCifrasDeDinero(markdown: string | undefined): boolean {
  return !!markdown && DINERO.test(plegar(markdown));
}

export interface EntradaClasificacion {
  /** Ruta del archivo en Drive. Sin ruta no se puede saber: falla cerrado. */
  ruta?: string;
  /** El markdown completo, tal como llego (de ahi salen `sensibilidad` y las cifras). */
  markdown?: string;
}

/**
 * Decide la sensibilidad de un documento. Es una lista blanca: `general` hay
 * que ganarselo y todo lo demas es `costos`. En orden:
 *
 * 1. Sin ruta: `costos` (no se puede comprobar el paso 3).
 * 2. El texto declara `sensibilidad` con algo que no es `general`, o la
 *    repite: `costos` (ver declaracionDeSensibilidad).
 * 3. Un segmento de la ruta es `04_Costos` o `01_Cotizaciones`: `costos`, y
 *    nada lo baja, ni siquiera `sensibilidad: general`.
 * 4. `sensibilidad: general` VALIDO: `general`. Es lo unico que anula los
 *    pasos 5 a 7.
 * 5. Algun segmento de la ruta (carpeta o archivo) contiene una de las
 *    RAICES_DE_COSTOS: `costos`.
 * 6. Ninguna CARPETA de la ruta (el nombre del archivo no cuenta) es `Juntas`,
 *    `02_Proyecto` o `03_Entregables`: `costos` (fichas CLIENTE.md y
 *    PROYECTO_*.md, brand kits, carpetas sin numero, etc.).
 * 7. El texto trae cifras de dinero (PATRONES_DE_DINERO): `costos`.
 * 8. Cualquier otra cosa: `general`.
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
  if (!carpetas.some((s) => CARPETAS_GENERALES.includes(s))) {
    return 'costos';
  }
  return contieneCifrasDeDinero(entrada.markdown) ? 'costos' : 'general';
}

function segmentosDe(ruta: string | undefined): string[] {
  return (ruta ?? '').split(/[/\\]+/).filter((s) => s.trim() !== '');
}

/** El segmento (ya normalizado) trae una raiz de precios; las de varias palabras tambien pegadas. */
function esNombreDeCostos(normalizado: string): boolean {
  const pegado = normalizado.replace(/ /g, '');
  return RAICES_DE_COSTOS.some((raiz) =>
    raiz.includes(' ')
      ? normalizado.includes(raiz) || pegado.includes(raiz.replace(/ /g, ''))
      : normalizado.includes(raiz)
  );
}
