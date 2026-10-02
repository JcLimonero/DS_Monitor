import type { LlamadaArchivada } from '../nucleo/contrato.js';
import {
  ErrorBorradoNoPermitido,
  ErrorProveedor,
  ErrorReconectarGoogle,
  describir
} from '../nucleo/errores.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import {
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
/** Tope duro de paginas de 50 que se revisan en Fireflies (2,000 llamadas). */
const MAXIMO_PAGINAS = 40;
const TAMANO_PAGINA = 50;
/** Al paginar se corta al juntar tantas por archivar: de sobra para una tanda. */
const SUFICIENTES_POR_ARCHIVAR = 100;

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
  /** Crea los pendientes de la junta (si no existian). */
  procesar(id: string): Promise<void>;
  /** Cambia la liga de Fireflies por la del Doc en pendientes y anotaciones. */
  reemplazarLiga(urlVieja: string, urlNueva: string): Promise<void>;
  ahora(): Date;
}

export interface ResumenArchivado {
  /** Docs nuevos subidos y verificados. */
  archivadas: number;
  /** Borradas de Fireflies (incluye reintentos de corridas anteriores). */
  borradas: number;
  /**
   * Cuantas mas quedan por archivar (se hacen en la siguiente corrida). Es un
   * minimo: al paginar se corta en cuanto hay suficientes.
   */
  pendientes: number;
  errores: string[];
  /** Hay que volver a conectar la cuenta de Google (le falta el permiso de Drive). */
  reconectarGoogle?: boolean;
}

export interface OpcionesArchivado {
  /** Archivar solo esta llamada (y sin esperar el reposo). */
  id?: string;
  maximo?: number;
  /** Subir los Docs pero no borrar nada de Fireflies (ni reintentar borrados). */
  soloArchivar?: boolean;
}

function ordenadas(lista: LlamadaArchivada[]): LlamadaArchivada[] {
  return [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/**
 * Las transcripciones de Fireflies que todavia no estan archivadas. Las ya
 * conocidas se saltan al paginar (con el borrado apagado ocupan las primeras
 * paginas y las viejas nunca se alcanzarian); se corta al juntar suficientes.
 */
async function listarPorArchivar(p: Puertos): Promise<Transcripcion[]> {
  const conocidas = new Set(p.llamadas().map((l) => l.id));
  const nuevas: Transcripcion[] = [];
  for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina++) {
    const lote = await p.fireflies.listar(
      pagina * TAMANO_PAGINA,
      TAMANO_PAGINA
    );
    nuevas.push(...lote.filter((t) => !conocidas.has(t.id)));
    if (
      lote.length < TAMANO_PAGINA ||
      nuevas.length >= SUFICIENTES_POR_ARCHIVAR
    ) {
      break;
    }
  }
  return nuevas;
}

/** Fireflies ya no la tiene (se borro por otro lado). */
function yaNoExiste(error: unknown): boolean {
  if (!(error instanceof ErrorProveedor)) {
    return false;
  }
  const causa = error.causa as { codigo?: string } | undefined;
  return error.estado === 404 || causa?.codigo === 'object_not_found';
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
  /** El permiso de Drive falta: nada de lo que sigue puede verificar un Doc. */
  let sinPermisoDrive = false;
  const borrar = p.borrarDeFireflies() && !opciones.soloArchivar;

  /** Anota que la llamada ya no esta en Fireflies; un fallo al guardar no tumba la corrida. */
  const anotarBorrada = async (id: string): Promise<void> => {
    try {
      await p.guardar(
        p
          .llamadas()
          .map((l) => (l.id === id ? { ...l, borradaDeFireflies: true } : l))
      );
    } catch (error) {
      marcarError(
        `"${id}" ya se borró de Fireflies pero no se pudo anotar (se corrige en la próxima corrida): ${describir(error)}`
      );
    }
  };

  const marcarError = (mensaje: string, error?: unknown) => {
    resumen.errores.push(mensaje);
    if (error instanceof ErrorReconectarGoogle) {
      resumen.reconectarGoogle = true;
    }
    console.warn(`[puente] llamadas: ${mensaje}`);
  };

  const borrarYMarcar = async (id: string): Promise<void> => {
    if (borradoBloqueado || !borrar || intentadas.has(id)) {
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
    resumen.borradas++;
    await anotarBorrada(id);
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
      const todas = await listarPorArchivar(p);
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
      sinPermisoDrive = error instanceof ErrorReconectarGoogle;
      break;
    }
    try {
      if (accion === 'procesar-y-archivar') {
        try {
          await p.procesar(previa.id);
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
      // Si no se pudo, no se borra: el pendiente se quedaria con una liga
      // muerta. El reintento de borrado de abajo lo vuelve a intentar.
      let ligaOk = true;
      if (completa.url) {
        try {
          await p.reemplazarLiga(completa.url, doc.url);
        } catch (error) {
          ligaOk = false;
          marcarError(
            `${nombre}: no se pudo cambiar la liga en los pendientes, no se borra de Fireflies todavía: ${describir(error)}`
          );
        }
      }
      if (ligaOk) {
        await borrarYMarcar(completa.id);
      }
    } catch (error) {
      marcarError(
        `${nombre}: ${describir(error)}; se reintenta en la próxima corrida`,
        error
      );
      if (error instanceof ErrorReconectarGoogle) {
        sinPermisoDrive = true;
        break;
      }
    }
  }

  // 3. Reintentar los borrados que quedaron pendientes en corridas anteriores.
  //    Antes de cada borrado se vuelve a verificar el Doc (puede haberse ido a
  //    la papelera, borrado, o la cuenta perdido el permiso): el borrado en
  //    Fireflies es irreversible, asi que nunca se confia en la verificacion
  //    de una corrida anterior.
  if (!opciones.id && borrar && !sinPermisoDrive) {
    const porBorrar = p
      .llamadas()
      .filter((x) => !x.borradaDeFireflies && !intentadas.has(x.id));
    let carpeta = carpetaId;
    if (porBorrar.length > 0 && carpeta === undefined) {
      try {
        carpeta = await p.drive.carpeta();
      } catch (error) {
        marcarError(
          `no se pudo preparar la carpeta de Drive para reintentar borrados: ${describir(error)}`,
          error
        );
      }
    }
    const carpetaFija = carpeta;
    for (const l of carpetaFija === undefined ? [] : porBorrar) {
      if (borradoBloqueado) {
        break;
      }
      try {
        let completa: Transcripcion;
        try {
          completa = await p.fireflies.bajar(l.id);
        } catch (error) {
          if (yaNoExiste(error)) {
            await anotarBorrada(l.id);
            continue;
          }
          throw error;
        }
        await p.drive.verificar(
          { id: l.docId, url: l.docUrl },
          carpetaFija as string,
          textoDeTranscripcion(completa)
        );
        // La liga de los pendientes tambien se asegura aqui (es idempotente):
        // una corrida anterior pudo no alcanzar a cambiarla.
        if (completa.url) {
          await p.reemplazarLiga(completa.url, l.docUrl);
        }
      } catch (error) {
        marcarError(
          `"${l.titulo}": no se borra de Fireflies porque no se pudo verificar el Doc en Drive o cambiar la liga: ${describir(error)}`,
          error
        );
        if (error instanceof ErrorReconectarGoogle) {
          break;
        }
        continue;
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
    if (a.id !== doc.id) {
      throw new Error('Drive devolvió otro archivo, no el Doc guardado');
    }
    if (a.trashed) {
      throw new Error('el Doc está en la papelera de Drive');
    }
    if (a.mimeType !== 'application/vnd.google-apps.document') {
      throw new Error('el archivo subido no quedó como Google Doc');
    }
    if (!a.parents?.includes(carpetaId)) {
      throw new Error('el Doc no quedó en la carpeta de llamadas');
    }
    const exportado = await deps.exportar(token, doc.id);
    if (!contenidoCompleto(texto, exportado)) {
      throw new Error('el Doc subido no trae el final de la conversación');
    }
  };
}
