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

/**
 * Recorre carpetas de Drive y junta los Markdown. El indice del RAG no entra:
 * no es una junta.
 */
export async function juntarMarkdown(
  raices: readonly RaizDrive[],
  listar: (padreId: string) => Promise<HijoDrive[]>,
  opciones: { limite?: number; profundidad?: number } = {}
): Promise<{ archivos: MarkdownEnDrive[]; completo: boolean }> {
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
      const ruta = prefijo ? `${prefijo}/${nombre}` : nombre;
      if (hijo.mimeType === MIME_CARPETA) {
        await bajar(hijo.id, ruta, profundidad + 1);
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

function esMarkdown(nombre: string, mime: string | undefined): boolean {
  if (/^indice_rag(\.md)?$/i.test(nombre)) {
    return false;
  }
  if (/\.md$/i.test(nombre)) {
    return true;
  }
  return mime === 'text/markdown';
}
