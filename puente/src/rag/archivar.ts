import type {
  CrmActividadCliente,
  JuntaRag,
  TaskItem
} from '../nucleo/contrato.js';
import { describir } from '../nucleo/errores.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import { carpetaDeEmpresa, type CarpetaEmpresaRag } from './config.js';
import {
  huellaMarkdown,
  markdownDeJunta,
  nombreMarkdown,
  upsertIndice,
  type EntradaIndice
} from './markdown.js';
import {
  aplicarAsignacion,
  resolverJunta,
  type AliasItech,
  type AsignacionJunta,
  type CatalogoJunta,
  type ResolucionJunta
} from './resolver.js';

export interface ArchivoRag {
  id: string;
  url: string;
  parents?: string[];
}

export interface PuertosRag {
  carpeta(padreId: string, nombre: string): Promise<string>;
  buscar(firefliesId: string): Promise<ArchivoRag | undefined>;
  subir(
    carpetaId: string,
    nombre: string,
    texto: string,
    firefliesId: string
  ): Promise<ArchivoRag>;
  actualizar(
    fileId: string,
    carpetaId: string,
    nombre: string,
    texto: string
  ): Promise<ArchivoRag>;
  verificar(fileId: string, carpetaId: string, texto: string): Promise<void>;
  indiceLeer(): Promise<{ editable: boolean; texto: string }>;
  indiceGuardar(texto: string): Promise<void>;
  juntas(): JuntaRag[];
  guardarJunta(junta: JuntaRag): Promise<void>;
  actividades(): CrmActividadCliente[];
  guardarActividades(lista: CrmActividadCliente[]): Promise<void>;
  pendientes(): TaskItem[];
  guardarPendientes(lista: TaskItem[]): Promise<void>;
  borrarFireflies(id: string): Promise<void>;
  ahora(): Date;
}

export interface ContextoRag {
  catalogo: CatalogoJunta;
  carpetas: readonly CarpetaEmpresaRag[];
  aliasesItech?: AliasItech[];
  asignacion?: AsignacionJunta;
  /** Borrar de Fireflies solo si el Markdown quedo confirmado. */
  borrar: boolean;
  /** Sin cuenta de servicio no se intenta Drive ni se borra nada. */
  driveConfigurado?: boolean;
}

export interface ResultadoArchivoRag {
  id: string;
  estado: 'archivada' | 'sin_asignar';
  esItech: boolean;
  driveConfirmado: boolean;
  borrada: boolean;
  /** Se escribio una actividad de CRM. Itech nunca. */
  actividad: boolean;
  /** Se ligo el pendiente al proyecto del CRM. Itech nunca. */
  pendienteLigado: boolean;
  indice: 'actualizado' | 'omitido' | 'no_aplica';
  motivo?: string;
}

/** El pendiente padre queda con el nombre del proyecto, no con el titulo. */
export function ligarPendienteAlProyecto(
  tareas: readonly TaskItem[],
  firefliesId: string,
  proyectoNombre: string,
  ahora: string
): { tareas: TaskItem[]; cambio: boolean } {
  const id = `fireflies-${firefliesId}`;
  let cambio = false;
  const salida = tareas.map((t) => {
    if (t.id !== id || t.project === proyectoNombre) {
      return t;
    }
    cambio = true;
    return { ...t, project: proyectoNombre, updatedAt: ahora };
  });
  return { tareas: salida, cambio };
}

export function actividadDeJunta(
  t: Transcripcion,
  clienteId: string,
  proyectoId: string,
  driveUrl: string | undefined,
  ahora: string
): CrmActividadCliente {
  const resumen = [driveUrl, t.resumen?.trim() || t.titulo]
    .filter((x) => x)
    .join('\n')
    .slice(0, 1000);
  const fecha = Number.isNaN(Date.parse(t.fecha)) ? ahora : t.fecha;
  return {
    id: `junta-${t.id}`,
    clienteId,
    proyectoId,
    tipo: 'junta',
    resumen,
    fecha,
    actualizadoEn: ahora
  };
}

export function upsertActividad(
  lista: readonly CrmActividadCliente[],
  actividad: CrmActividadCliente
): { lista: CrmActividadCliente[]; cambio: boolean } {
  const i = lista.findIndex((a) => a.id === actividad.id);
  if (i < 0) {
    return { lista: [...lista, actividad], cambio: true };
  }
  const previa = lista[i] as CrmActividadCliente;
  if (
    previa.resumen === actividad.resumen &&
    previa.clienteId === actividad.clienteId &&
    previa.proyectoId === actividad.proyectoId &&
    previa.fecha === actividad.fecha
  ) {
    return { lista: [...lista], cambio: false };
  }
  const copia = [...lista];
  copia[i] = actividad;
  return { lista: copia, cambio: true };
}

function nombreCarpeta(nombre: string): string {
  return nombre
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function metaDe(resolucion: ResolucionJunta): {
  cliente: string;
  proyecto: string;
  empresa?: string;
} {
  if (resolucion.estado === 'resuelta') {
    return {
      cliente: resolucion.clienteNombre,
      proyecto: resolucion.proyectoNombre,
      empresa: resolucion.empresaNombre
    };
  }
  return {
    cliente: 'Sin asignar',
    proyecto: 'Sin asignar',
    empresa: resolucion.empresaNombre
  };
}

function juntaBase(
  t: Transcripcion,
  resolucion: ResolucionJunta,
  texto: string,
  huella: string,
  ahora: string,
  previa: JuntaRag | undefined
): JuntaRag {
  const resuelta = resolucion.estado === 'resuelta';
  return {
    id: t.id,
    titulo: t.titulo,
    fecha: t.fecha,
    duracionMin: t.duracionMin,
    participantes: t.participantes,
    resumen: t.resumen?.trim() || undefined,
    texto,
    empresaId: resolucion.empresaId ?? previa?.empresaId,
    empresaNombre: resolucion.empresaNombre ?? previa?.empresaNombre,
    clienteId:
      resuelta && !resolucion.esItech ? resolucion.clienteId : undefined,
    clienteNombre: resuelta ? resolucion.clienteNombre : undefined,
    proyectoId:
      resuelta && !resolucion.esItech ? resolucion.proyectoId : undefined,
    proyectoNombre: resuelta ? resolucion.proyectoNombre : undefined,
    driveFileId: previa?.driveFileId,
    driveUrl: previa?.driveUrl,
    firefliesUrl: t.url,
    estado: 'sin_asignar',
    esItech: resolucion.esItech,
    motivo: resolucion.estado === 'sin_asignar' ? resolucion.motivo : undefined,
    huella,
    archivadaEn: previa?.archivadaEn,
    driveConfirmado: false,
    borradaDeFireflies: previa?.borradaDeFireflies ?? false,
    actualizadoEn: ahora
  };
}

function misma(a: JuntaRag | undefined, b: JuntaRag): boolean {
  if (!a) {
    return false;
  }
  return (
    a.estado === b.estado &&
    a.motivo === b.motivo &&
    a.esItech === b.esItech &&
    a.clienteId === b.clienteId &&
    a.proyectoId === b.proyectoId &&
    a.clienteNombre === b.clienteNombre &&
    a.proyectoNombre === b.proyectoNombre &&
    a.huella === b.huella &&
    a.driveConfirmado === b.driveConfirmado &&
    a.driveFileId === b.driveFileId &&
    a.borradaDeFireflies === b.borradaDeFireflies &&
    a.texto === b.texto
  );
}

async function guardarSiCambia(
  puertos: PuertosRag,
  previa: JuntaRag | undefined,
  junta: JuntaRag
): Promise<void> {
  if (misma(previa, junta)) {
    return;
  }
  await puertos.guardarJunta(junta);
}

/**
 * Resuelve, guarda el Markdown en la carpeta del proyecto y, si no es Itech,
 * anota la actividad y liga el pendiente. No borra de Fireflies hasta
 * confirmar el archivo, y solo si `borrar` esta prendido.
 *
 * El pendiente `fireflies-{id}` lo crea el flujo de juntas, tambien para
 * Itech. Aqui no se borra: en Itech simplemente no se reescribe `project`.
 */
export async function archivarJuntaEnRag(
  t: Transcripcion,
  ctx: ContextoRag,
  puertos: PuertosRag
): Promise<ResultadoArchivoRag> {
  const ahora = puertos.ahora().toISOString();
  const previa = puertos.juntas().find((j) => j.id === t.id);
  const resolucion = ctx.asignacion
    ? aplicarAsignacion(t, ctx.asignacion, ctx.catalogo)
    : resolverJunta(t, ctx.catalogo, ctx.aliasesItech ?? []);
  const meta = metaDe(resolucion);
  const texto = markdownDeJunta(t, meta);
  const huella = huellaMarkdown(texto);
  const base = juntaBase(t, resolucion, texto, huella, ahora, previa);

  const salir = async (
    junta: JuntaRag,
    extra: Partial<ResultadoArchivoRag>
  ): Promise<ResultadoArchivoRag> => {
    await guardarSiCambia(puertos, previa, junta);
    return {
      id: t.id,
      estado: junta.estado,
      esItech: junta.esItech,
      driveConfirmado: junta.driveConfirmado,
      borrada: junta.borradaDeFireflies,
      actividad: false,
      pendienteLigado: false,
      indice: 'no_aplica',
      motivo: junta.motivo,
      ...extra
    };
  };

  if (resolucion.estado !== 'resuelta') {
    return salir(base, {});
  }

  if (ctx.driveConfigurado === false) {
    return salir(
      {
        ...base,
        motivo:
          'Falta configurar la cuenta de servicio y las carpetas de Drive del RAG.'
      },
      {}
    );
  }

  const carpetaEmpresa = carpetaDeEmpresa(resolucion.empresaId, ctx.carpetas);
  if (!carpetaEmpresa) {
    return salir(
      {
        ...base,
        motivo: `Falta la carpeta de Drive de ${resolucion.empresaNombre ?? 'la empresa'}.`
      },
      {}
    );
  }

  let carpetaJuntas: string;
  let archivo: ArchivoRag | undefined;
  try {
    if (!resolucion.esItech && resolucion.carpetaProyectoId) {
      carpetaJuntas = await puertos.carpeta(
        resolucion.carpetaProyectoId,
        'Juntas'
      );
    } else {
      const cliente = await puertos.carpeta(
        carpetaEmpresa,
        nombreCarpeta(resolucion.clienteNombre)
      );
      const proyecto = await puertos.carpeta(cliente, '02_Proyecto');
      carpetaJuntas = await puertos.carpeta(proyecto, 'Juntas');
    }
    const nombre = nombreMarkdown(t);
    const existente = await puertos.buscar(t.id);
    if (
      existente &&
      previa?.huella === huella &&
      previa.driveConfirmado &&
      existente.parents?.includes(carpetaJuntas)
    ) {
      archivo = existente;
    } else if (existente) {
      archivo = await puertos.actualizar(
        existente.id,
        carpetaJuntas,
        nombre,
        texto
      );
    } else {
      archivo = await puertos.subir(carpetaJuntas, nombre, texto, t.id);
    }
    await puertos.verificar(archivo.id, carpetaJuntas, texto);
  } catch (error) {
    if (previa?.driveConfirmado) {
      return salir(previa, { motivo: describir(error) });
    }
    return salir(
      { ...base, motivo: describir(error), driveConfirmado: false },
      {}
    );
  }

  const confirmada: JuntaRag = {
    ...base,
    estado: 'archivada',
    motivo: undefined,
    driveFileId: archivo.id,
    driveUrl: archivo.url,
    huella,
    archivadaEn: previa?.archivadaEn ?? ahora,
    driveConfirmado: true
  };

  let indice: ResultadoArchivoRag['indice'] = 'omitido';
  try {
    const actual = await puertos.indiceLeer();
    if (actual.editable && confirmada.driveUrl) {
      const entrada: EntradaIndice = {
        id: t.id,
        fecha: t.fecha,
        cliente: resolucion.clienteNombre,
        proyecto: resolucion.proyectoNombre,
        titulo: t.titulo,
        url: confirmada.driveUrl
      };
      await puertos.indiceGuardar(upsertIndice(actual.texto, entrada));
      indice = 'actualizado';
    }
  } catch {
    indice = 'omitido';
  }

  let actividad = false;
  let pendienteLigado = false;
  if (!resolucion.esItech) {
    const nueva = actividadDeJunta(
      t,
      resolucion.clienteId,
      resolucion.proyectoId,
      confirmada.driveUrl,
      ahora
    );
    const actividades = upsertActividad(puertos.actividades(), nueva);
    if (actividades.cambio) {
      await puertos.guardarActividades(actividades.lista);
    }
    actividad = true;
    const ligados = ligarPendienteAlProyecto(
      puertos.pendientes(),
      t.id,
      resolucion.proyectoNombre,
      ahora
    );
    if (ligados.cambio) {
      await puertos.guardarPendientes(ligados.tareas);
      pendienteLigado = true;
    }
  }

  let borrada = confirmada.borradaDeFireflies;
  if (ctx.borrar && !borrada) {
    try {
      await puertos.borrarFireflies(t.id);
      borrada = true;
    } catch (error) {
      confirmada.motivo = `No se pudo borrar de Fireflies: ${describir(error)}`;
    }
  }
  confirmada.borradaDeFireflies = borrada;
  await guardarSiCambia(puertos, previa, confirmada);
  return {
    id: t.id,
    estado: 'archivada',
    esItech: resolucion.esItech,
    driveConfirmado: true,
    borrada,
    actividad,
    pendienteLigado,
    indice,
    motivo: confirmada.motivo
  };
}
