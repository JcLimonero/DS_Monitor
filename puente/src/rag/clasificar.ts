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
 */
export const CARPETAS_COSTOS: readonly string[] = [
  '04 costos',
  '01 cotizaciones'
];

export interface EntradaClasificacion {
  /** Ruta del archivo en Drive. Sin ruta no se puede saber: falla cerrado. */
  ruta?: string;
  /** Frontmatter ya leido del markdown (las llaves se buscan sin distinguir mayusculas). */
  frontmatter?: Readonly<Record<string, unknown>>;
}

/**
 * Decide la sensibilidad de un documento. Siempre falla cerrado: ante la
 * duda es `costos`, y `general` es la unica respuesta que hay que ganarse.
 *
 * `costos` si:
 * - algun segmento de la ruta es `04_Costos` o `01_Cotizaciones` (la ruta
 *   manda: el frontmatter nunca baja un documento de costos a general);
 * - no hay ruta (una ingesta sin ruta queda como costos hasta que se
 *   vuelva a mandar con su ruta);
 * - el frontmatter trae `sensibilidad` y su valor no es exactamente
 *   `general` (cualquier mayuscula): `costos`, un valor desconocido, uno
 *   vacio o una lista.
 *
 * En cualquier otro caso es `general`.
 */
export function clasificarSensibilidad(
  entrada: EntradaClasificacion
): Sensibilidad {
  const segmentos = segmentosDe(entrada.ruta);
  if (segmentos.length === 0) {
    return 'costos';
  }
  if (segmentos.some((s) => CARPETAS_COSTOS.includes(normalizarTexto(s)))) {
    return 'costos';
  }
  for (const declarada of declaradasEnFrontmatter(entrada.frontmatter)) {
    if (
      typeof declarada !== 'string' ||
      declarada.trim().toLowerCase() !== 'general'
    ) {
      return 'costos';
    }
  }
  return 'general';
}

function segmentosDe(ruta: string | undefined): string[] {
  return (ruta ?? '').split(/[/\\]+/).filter((s) => s.trim() !== '');
}

/** Todos los valores de `sensibilidad` del frontmatter, con cualquier mayuscula en la llave. */
function declaradasEnFrontmatter(
  frontmatter: Readonly<Record<string, unknown>> | undefined
): unknown[] {
  if (!frontmatter) {
    return [];
  }
  return Object.entries(frontmatter)
    .filter(([clave]) => clave.trim().toLowerCase() === 'sensibilidad')
    .map(([, valor]) => valor);
}
