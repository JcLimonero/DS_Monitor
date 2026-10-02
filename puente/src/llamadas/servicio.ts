import type { LlamadaArchivada } from '../nucleo/contrato.js';
import {
  ErrorBorradoNoPermitido,
  ErrorReconectarGoogle,
  describir
} from '../nucleo/errores.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import {
  DIAS_CON_AVISO,
  ESPERA_SIN_FRASES_HORAS,
  cabeEnUnDoc,
  contenidoCompleto,
  nombreDeArchivo,
  porArchivar,
  textoDeTranscripcion,
  type DecisionArchivo
} from './archivar.js';

/**
 * El archivado de llamadas: por cada transcripcion de Fireflies que toca,
 * baja el texto completo, lo sube a Drive como Google Doc, comprueba que
 * quedo, lo anota en la tabla `llamadas` y solo entonces la borra de
 * Fireflies. Si algo falla antes del borrado, la llamada se queda en
 * Fireflies y se reintenta en la siguiente corrida.
 *
 * Todo lo que toca la red entra por `Puertos`, para probar el orden de los
 * pasos (sobre todo "no borrar si la subida fallo") sin Fireflies ni Google.
 */

/** Cuantas llamadas como maximo por corrida: acota el tiempo de la peticion. */
export const MAXIMO_POR_CORRIDA = 15;
/** Cuantas paginas de 50 se revisan en Fireflies buscando llamadas por archivar. */
const MAXIMO_PAGINAS = 6;
const TAMANO_PAGINA = 50;

export interface ArchivoSubido {
  id: string;
  url: string;
}

export interface PuertosDrive {
  /** El id de la carpeta de las llamadas (la busca o la crea). */
  carpeta(): Promise<string>;
  /** Un Doc de esa llamada que una corrida anterior ya subio, si existe. */
  existente(
    carpetaId: string,
    firefliesId: string
  ): Promise<ArchivoSubido | undefined>;
  subir(
    carpetaId: string,
    nombre: string,
    texto: string,
    firefliesId: string
  ): Promise<ArchivoSubido>;
  /** Lanza si el Doc no esta donde debe o le falta contenido. */
  verificar(
    doc: ArchivoSubido,
    carpetaId: string,
    texto: string
  ): Promise<void>;
}

export interface PuertosFireflies {
  /** Una pagina de transcripciones (sin la conversacion). */
  listar(saltar: number, limite: number): Promise<Transcripcion[]>;
  /** La transcripcion con la conversacion completa. */
  bajar(id: string): Promise<Transcripcion>;
  borrar(id: string): Promise<void>;
}

export interface Puertos {
  fireflies: PuertosFireflies;
  drive: PuertosDrive;
  /** Interruptor de Llamadas: borrar de Fireflies al archivar. */
  borrarDeFireflies(): boolean;
  llamadas(): LlamadaArchivada[];
  guardar(lista: LlamadaArchivada[]): Promise<void>;
  procesada(id: string): boolean;
  /** Crea los pendientes de la junta (si no existian). `avisar`: push al celular. */
  procesar(id: string, avisar: boolean): Promise<void>;
  /** Cambia la liga de Fireflies por la del Doc en pendientes y anotaciones. */
  reemplazarLiga(urlVieja: string, urlNueva: string): Promise<void>;
  ahora(): Date;
}

export interface ResumenArchivado {
  /** Docs nuevos subidos y verificados. */
  archivadas: number;
  /** Borradas de Fireflies (incluye reintentos de corridas anteriores). */
  borradas: number;
  /** Cuantas mas quedan por archivar (se hacen en la siguiente corrida). */
  pendientes: number;
  errores: string[];
  /** Hay que volver a conectar la cuenta de Google (le falta el permiso de Drive). */
  reconectarGoogle?: boolean;
}

export interface OpcionesArchivado {
  /** Archivar solo esta llamada (y sin esperar el reposo). */
  id?: string;
  maximo?: number;
}

function ordenadas(lista: LlamadaArchivada[]): LlamadaArchivada[] {
  return [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

async function listarTodas(p: Puertos): Promise<Transcripcion[]> {
  const todas: Transcripcion[] = [];
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const lote = await p.fireflies.listar(
      pagina * TAMANO_PAGINA,
      TAMANO_PAGINA
    );
    todas.push(...lote);
    if (lote.length < TAMANO_PAGINA) {
      break;
    }
  }
  return todas;
}

function mapaProcesadas(p: Puertos, ts: Transcripcion[]): Record<string, true> {
  const m: Record<string, true> = {};
  for (const t of ts) {
    if (p.procesada(t.id)) {
      m[t.id] = true;
    }
  }
  return m;
}

export async function archivarLlamadas(
  p: Puertos,
  opciones: OpcionesArchivado = {}
): Promise<ResumenArchivado> {
  const resumen: ResumenArchivado = {
    archivadas: 0,
    borradas: 0,
    pendientes: 0,
    errores: []
  };
  const ahora = p.ahora();
  const maximo = opciones.maximo ?? MAXIMO_POR_CORRIDA;
  /** Fireflies dijo "no puedes borrar": no se insiste en esta corrida. */
  let borradoBloqueado = false;
  /** Las que ya se intentaron borrar en esta corrida: no se repite el intento. */
  const intentadas = new Set<string>();

  const marcarError = (mensaje: string, error?: unknown) => {
    resumen.errores.push(mensaje);
    if (error instanceof ErrorReconectarGoogle) {
      resumen.reconectarGoogle = true;
    }
    console.warn(`[puente] llamadas: ${mensaje}`);
  };

  const borrarYMarcar = async (id: string): Promise<void> => {
    if (borradoBloqueado || !p.borrarDeFireflies() || intentadas.has(id)) {
      return;
    }
    intentadas.add(id);
    try {
      await p.fireflies.borrar(id);
    } catch (error) {
      if (error instanceof ErrorBorradoNoPermitido) {
        borradoBloqueado = true;
      }
      marcarError(
        `no se pudo borrar "${id}" de Fireflies (el Doc ya está en Drive): ${describir(error)}`,
        error
      );
      return;
    }
    await p.guardar(
      p
        .llamadas()
        .map((l) => (l.id === id ? { ...l, borradaDeFireflies: true } : l))
    );
    resumen.borradas++;
  };

  // 1. Que toca archivar.
  let decisiones: DecisionArchivo[];
  try {
    if (opciones.id) {
      const una = await p.fireflies.bajar(opciones.id);
      decisiones = porArchivar([una], p.llamadas(), mapaProcesadas(p, [una]), {
        ahora,
        forzar: true
      });
      if (decisiones.length === 0) {
        marcarError(`la llamada "${opciones.id}" ya estaba archivada`);
      }
    } else {
      const todas = await listarTodas(p);
      decisiones = porArchivar(todas, p.llamadas(), mapaProcesadas(p, todas), {
        ahora
      });
    }
  } catch (error) {
    marcarError(
      `no se pudo leer la lista de Fireflies: ${describir(error)}`,
      error
    );
    return resumen;
  }

  const tanda = decisiones.slice(0, maximo);
  resumen.pendientes = Math.max(0, decisiones.length - tanda.length);

  // 2. Archivar cada una; si algo falla antes del borrado, se sigue con la
  //    siguiente y esta se reintenta en la proxima corrida.
  let carpetaId: string | undefined;
  for (const { transcripcion: previa, accion } of tanda) {
    const nombre = `"${previa.titulo}"`;
    try {
      carpetaId ??= await p.drive.carpeta();
    } catch (error) {
      // Sin carpeta no hay nada que hacer con ninguna: se corta la corrida.
      marcarError(
        `no se pudo preparar la carpeta de Drive: ${describir(error)}`,
        error
      );
      break;
    }
    try {
      if (accion === 'procesar-y-archivar') {
        const reciente =
          ahora.getTime() - Date.parse(previa.fecha) <
          DIAS_CON_AVISO * 86_400_000;
        try {
          await p.procesar(previa.id, reciente);
        } catch (error) {
          marcarError(
            `${nombre}: no se pudieron crear los pendientes de la junta, no se archiva todavía: ${describir(error)}`
          );
          continue;
        }
      }
      const completa = await p.fireflies.bajar(previa.id);
      const sinFrases = (completa.frases ?? []).length === 0;
      if (
        sinFrases &&
        ahora.getTime() - Date.parse(completa.fecha) <
          ESPERA_SIN_FRASES_HORAS * 3_600_000
      ) {
        // Fireflies puede seguir transcribiendo: se espera, sin borrar nada.
        continue;
      }
      const texto = textoDeTranscripcion(completa);
      if (!cabeEnUnDoc(texto)) {
        marcarError(
          `${nombre}: la conversación es demasiado larga para un Google Doc (${texto.length.toLocaleString('es-MX')} caracteres); se queda en Fireflies`
        );
        continue;
      }
      const doc =
        (await p.drive.existente(carpetaId, completa.id)) ??
        (await p.drive.subir(
          carpetaId,
          nombreDeArchivo(completa),
          texto,
          completa.id
        ));
      await p.drive.verificar(doc, carpetaId, texto);

      const registro: LlamadaArchivada = {
        id: completa.id,
        titulo: completa.titulo,
        fecha: completa.fecha,
        duracionMin: completa.duracionMin,
        participantes: completa.participantes,
        resumen: completa.resumen?.trim() || undefined,
        docUrl: doc.url,
        docId: doc.id,
        archivadaEn: ahora.toISOString(),
        borradaDeFireflies: false
      };
      await p.guardar(
        ordenadas([
          ...p.llamadas().filter((l) => l.id !== registro.id),
          registro
        ])
      );
      resumen.archivadas++;

      // El Doc ya existe y esta anotado: ahora si se puede soltar la liga de
      // Fireflies en los pendientes y, despues, borrar la transcripcion.
      if (completa.url) {
        await p.reemplazarLiga(completa.url, doc.url).catch((error) => {
          marcarError(
            `${nombre}: no se pudo cambiar la liga en los pendientes: ${describir(error)}`
          );
        });
      }
      await borrarYMarcar(completa.id);
    } catch (error) {
      marcarError(
        `${nombre}: ${describir(error)}; se reintenta en la próxima corrida`,
        error
      );
      if (error instanceof ErrorReconectarGoogle) {
        break;
      }
    }
  }

  // 3. Reintentar los borrados que quedaron pendientes en corridas anteriores.
  if (!opciones.id && p.borrarDeFireflies()) {
    for (const l of p.llamadas().filter((x) => !x.borradaDeFireflies)) {
      if (borradoBloqueado) {
        break;
      }
      await borrarYMarcar(l.id);
    }
  }
  return resumen;
}

/**
 * Comprueba que el Doc subido quedo bien antes de borrar nada: es un Google
 * Doc, no esta en la papelera, esta en la carpeta y el texto exportado trae el
 * final de la conversacion (la subida no se corto).
 */
export function verificacionDeDoc(deps: {
  token: () => Promise<string>;
  archivo: (
    token: string,
    id: string
  ) => Promise<{
    id: string;
    mimeType?: string;
    trashed?: boolean;
    parents?: string[];
  }>;
  exportar: (token: string, id: string) => Promise<string>;
}): PuertosDrive['verificar'] {
  return async (doc, carpetaId, texto) => {
    const token = await deps.token();
    const a = await deps.archivo(token, doc.id);
    if (a.trashed) {
      throw new Error('el Doc está en la papelera de Drive');
    }
    if (a.mimeType !== 'application/vnd.google-apps.document') {
      throw new Error('el archivo subido no quedó como Google Doc');
    }
    if (a.parents && !a.parents.includes(carpetaId)) {
      throw new Error('el Doc no quedó en la carpeta de llamadas');
    }
    const exportado = await deps.exportar(token, doc.id);
    if (!contenidoCompleto(texto, exportado)) {
      throw new Error('el Doc subido no trae el final de la conversación');
    }
  };
}
