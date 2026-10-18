import { normalizarTexto } from '../proveedores/fireflies.js';
import { EXCLUIR_POR_OMISION } from './config.js';

const MIME_CARPETA = 'application/vnd.google-apps.folder';

export interface HijoDrive {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface MarkdownEnDrive {
  id: string;
  name: string;
  ruta: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface RaizDrive {
  id: string;
  nombre: string;
}

export interface OpcionesRecorrido {
  limite?: number;
  profundidad?: number;
  /**
   * Carpetas en las que el recorrido no entra. Cada entrada se compara
   * normalizada (normalizarTexto: sin acentos ni mayusculas, el guion bajo
   * cuenta como espacio) y puede ser:
   * - un nombre (`_OBSOLETAS`): coincide con cualquier carpeta de ese nombre,
   *   en cualquier nivel;
   * - una ruta de dos o mas segmentos con `/` (`Interno/Arquitectura`):
   *   coincide cuando la ruta de la carpeta termina en esos segmentos.
   * Por omision: EXCLUIR_POR_OMISION.
   *
   * Lo excluido deja de "verse". Un recorrido completo no lo cuenta como
   * incompleto, asi que la reconciliacion diaria borra del indice lo que ya
   * estaba indexado ahi. Es lo deseado: lo excluido no debe quedar en el RAG.
   */
  excluir?: readonly string[];
}

/**
 * Recorre carpetas de Drive y junta los Markdown. El indice del RAG no entra:
 * no es una junta.
 */
export async function juntarMarkdown(
  raices: readonly RaizDrive[],
  listar: (padreId: string) => Promise<HijoDrive[]>,
  opciones: OpcionesRecorrido = {}
): Promise<{ archivos: MarkdownEnDrive[]; completo: boolean }> {
  const excluidas = excluidasDe(opciones.excluir ?? EXCLUIR_POR_OMISION);
  const limite = opciones.limite ?? 5000;
  const profundidadMax = opciones.profundidad ?? 8;
  const archivos: MarkdownEnDrive[] = [];
  let completo = true;

  const bajar = async (
    padreId: string,
    prefijo: string,
    profundidad: number
  ) => {
    if (archivos.length >= limite || profundidad > profundidadMax) {
      completo = false;
      return;
    }
    let hijos: HijoDrive[];
    try {
      hijos = await listar(padreId);
    } catch {
      completo = false;
      return;
    }
    for (const hijo of hijos) {
      if (archivos.length >= limite) {
        completo = false;
        return;
      }
      const nombre = hijo.name?.trim();
      if (!hijo.id || !nombre) {
        continue;
      }
      // Drive admite `/` y `\` en un nombre: sin esto un solo nombre se leeria
      // como varias carpetas de la ruta.
      const segmento = nombre.replace(/[/\\]+/g, '-');
      const ruta = prefijo ? `${prefijo}/${segmento}` : segmento;
      if (hijo.mimeType === MIME_CARPETA) {
        if (!estaExcluida(ruta, excluidas)) {
          await bajar(hijo.id, ruta, profundidad + 1);
        }
        continue;
      }
      if (!esMarkdown(nombre, hijo.mimeType)) {
        continue;
      }
      archivos.push({
        id: hijo.id,
        name: nombre,
        ruta,
        modifiedTime: hijo.modifiedTime,
        webViewLink: hijo.webViewLink
      });
    }
  };

  for (const raiz of raices) {
    await bajar(raiz.id, raiz.nombre, 1);
  }
  return { archivos, completo };
}

/** Las entradas de `excluir` ya normalizadas, partidas en segmentos. */
function excluidasDe(entradas: readonly string[]): string[][] {
  return entradas
    .map((entrada) =>
      entrada
        .split('/')
        .map((segmento) => normalizarTexto(segmento))
        .filter(Boolean)
    )
    .filter((segmentos) => segmentos.length > 0);
}

/** La ruta de la carpeta termina en los segmentos de alguna entrada. */
function estaExcluida(ruta: string, excluidas: string[][]): boolean {
  if (excluidas.length === 0) {
    return false;
  }
  const segmentos = ruta.split('/').map((s) => normalizarTexto(s));
  return excluidas.some(
    (entrada) =>
      entrada.length <= segmentos.length &&
      entrada.every(
        (segmento, i) =>
          segmentos[segmentos.length - entrada.length + i] === segmento
      )
  );
}

function esMarkdown(nombre: string, mime: string | undefined): boolean {
  if (/^indice_rag(\.md)?$/i.test(nombre)) {
    return false;
  }
  if (/\.md$/i.test(nombre)) {
    return true;
  }
  return mime === 'text/markdown';
}
