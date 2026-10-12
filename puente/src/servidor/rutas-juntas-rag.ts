import type { Configuracion } from '../config/entorno.js';
import type { AlmacenJson } from '../datos/almacen-json.js';
import type { AlmacenTabla } from '../datos/almacen-tabla.js';
import type { ConfigLlamadas } from '../llamadas/config.js';
import { REVISION_MINUTOS } from '../nucleo/programador.js';
import type {
  CrmActividadCliente,
  CrmCliente,
  CrmContacto,
  CrmProyecto,
  Empresa,
  JuntaRag,
  RolCrm,
  TaskItem,
  UsuarioCrm
} from '../nucleo/contrato.js';
import { ErrorPuente, describir } from '../nucleo/errores.js';
import {
  archivoDeDrive,
  archivoPorNombre,
  archivoPorPropiedad,
  actualizarMarkdown,
  carpetaDentroDe,
  subirMarkdown,
  textoDeArchivo,
  tokenDeCuentaServicio
} from '../proveedores/google.js';
import {
  normalizarTexto,
  type Transcripcion
} from '../proveedores/fireflies.js';
import { markdownConfirmado } from '../rag/markdown.js';
import {
  archivarJuntaEnRag,
  type ResultadoArchivoRag
} from '../rag/archivar.js';
import type { AsignacionJunta } from '../rag/resolver.js';
import { actorDe, juntasVisibles, type ActorJunta } from '../rag/permisos.js';
import {
  ROLES_FABRICA,
  buscarUsuarioPorCorreo,
  esDirector,
  permisosEfectivos,
  usuarioDirector
} from '../datos/roles-permisos.js';
import type { Programable } from './rutas-ia.js';
import type { Contexto, Router } from './router.js';

export interface DatosJuntasRag {
  juntasRag: AlmacenTabla<JuntaRag[]>;
  empresas: AlmacenTabla<Empresa[]>;
  crmClientes: AlmacenTabla<CrmCliente[]>;
  crmContactos: AlmacenTabla<CrmContacto[]>;
  crmProyectos: AlmacenTabla<CrmProyecto[]>;
  crmActividades: AlmacenTabla<CrmActividadCliente[]>;
  personales: AlmacenJson<TaskItem[]> | AlmacenTabla<TaskItem[]>;
  llamadasConfig: AlmacenJson<ConfigLlamadas>;
  rolesCrm: AlmacenTabla<RolCrm[]>;
  usuariosCrm: AlmacenTabla<UsuarioCrm[]>;
}

export interface DependenciasJuntasRag {
  router: Router;
  datos: DatosJuntasRag;
  cfg: () => Configuracion;
  correoDeSesion: (contexto: Contexto) => string | undefined;
  correosDelDueno: () => string[];
  esAdmin: (contexto: Contexto) => boolean;
  bajar: (id: string) => Promise<Transcripcion>;
  borrar: (id: string) => Promise<void>;
  listarRecientes: () => Promise<Transcripcion[]>;
  programables: Programable[];
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
}

export function registrarJuntasRag(deps: DependenciasJuntasRag): {
  archivar: (
    id: string,
    asignacion?: AsignacionJunta
  ) => Promise<ResultadoArchivoRag>;
} {
  const { router, datos } = deps;
  let cadena: Promise<unknown> = Promise.resolve();
  let indiceId: string | undefined;

  const enSerie = <T>(fn: () => Promise<T>): Promise<T> => {
    const corre = cadena.then(fn, fn);
    cadena = corre.then(
      () => undefined,
      () => undefined
    );
    return corre;
  };

  const tokenDrive = async (): Promise<string> => {
    const cuenta = deps.cfg().ragDrive?.cuenta;
    if (!cuenta) {
      throw new ErrorPuente(
        'Falta GOOGLE_DRIVE_CUENTA_SERVICIO para el RAG de juntas.',
        503
      );
    }
    return tokenDeCuentaServicio(cuenta);
  };

  const roles = () => {
    const guardados = datos.rolesCrm.leer();
    return guardados.length > 0 ? guardados : ROLES_FABRICA;
  };

  const actor = (contexto: Contexto): ActorJunta => {
    const correo = deps.correoDeSesion(contexto);
    if (!correo && deps.esAdmin(contexto)) {
      return actorDe(usuarioDirector('admin@local'), roles());
    }
    if (!correo && !deps.cfg().acceso) {
      return actorDe(usuarioDirector('dev@local'), roles());
    }
    if (!correo) {
      throw new ErrorPuente('Se requiere sesión para ver las juntas.', 401);
    }
    const esDelDueno = deps
      .correosDelDueno()
      .some((c) => c.toLowerCase() === correo.toLowerCase());
    const usuario =
      buscarUsuarioPorCorreo(correo, datos.usuariosCrm.leer()) ??
      (esDelDueno ? usuarioDirector(correo) : undefined);
    if (!usuario) {
      throw new ErrorPuente('No tienes acceso a las juntas del RAG.', 403);
    }
    const permisos = permisosEfectivos(usuario, roles());
    return {
      director: esDirector(permisos) || esDelDueno,
      usuario,
      permisos
    };
  };

  const catalogo = () => ({
    empresas: datos.empresas.leer(),
    clientes: datos.crmClientes.leer().map((c) => ({
      id: c.id,
      nombre: c.nombre
    })),
    contactos: datos.crmContactos.leer().map((c) => ({
      clienteId: c.clienteId,
      correo: c.correo,
      nombre: c.nombre
    })),
    proyectos: datos.crmProyectos.leer().map((p) => ({
      id: p.id,
      clienteId: p.clienteId,
      nombre: p.nombre,
      estado: p.estado,
      empresaAtiendeId: p.empresaAtiendeId,
      driveUrl: p.driveUrl
    }))
  });

  const aliases = () =>
    datos.juntasRag.leer().flatMap((j) =>
      j.esItech &&
      j.estado === 'archivada' &&
      j.clienteNombre &&
      j.proyectoNombre
        ? [
            {
              clienteNombre: j.clienteNombre,
              proyectoNombre: j.proyectoNombre
            }
          ]
        : []
    );

  const urlDe = (id: string, webViewLink?: string) =>
    webViewLink ?? `https://drive.google.com/file/d/${id}/view`;

  const archivar = (
    id: string,
    asignacion?: AsignacionJunta
  ): Promise<ResultadoArchivoRag> =>
    enSerie(async () => {
      const completa = await deps.bajar(id);
      const rag = deps.cfg().ragDrive;
      return archivarJuntaEnRag(
        completa,
        {
          catalogo: catalogo(),
          carpetas: rag?.carpetas ?? [],
          aliasesItech: aliases(),
          asignacion,
          borrar: datos.llamadasConfig.leer().borrarDeFireflies,
          driveConfigurado: rag !== undefined
        },
        {
          carpeta: (padreId, nombre) =>
            tokenDrive().then((token) =>
              carpetaDentroDe(token, padreId, nombre)
            ),
          buscar: async (firefliesId) => {
            const a = await archivoPorPropiedad(
              await tokenDrive(),
              'firefliesId',
              firefliesId
            );
            return a
              ? {
                  id: a.id,
                  url: urlDe(a.id, a.webViewLink),
                  parents: a.parents
                }
              : undefined;
          },
          subir: async (carpetaId, nombre, texto, firefliesId) => {
            const a = await subirMarkdown(
              await tokenDrive(),
              carpetaId,
              nombre,
              texto,
              { firefliesId }
            );
            return {
              id: a.id,
              url: urlDe(a.id, a.webViewLink),
              parents: [carpetaId]
            };
          },
          actualizar: async (fileId, carpetaId, nombre, texto) => {
            const token = await tokenDrive();
            const actual = await archivoDeDrive(token, fileId);
            const a = await actualizarMarkdown(token, fileId, texto, {
              nombre,
              carpetaId,
              padres: actual.parents
            });
            return {
              id: a.id,
              url: urlDe(a.id, a.webViewLink),
              parents: [carpetaId]
            };
          },
          verificar: async (fileId, carpetaId, texto) => {
            const token = await tokenDrive();
            const archivo = await archivoDeDrive(token, fileId);
            if (archivo.trashed) {
              throw new Error('el archivo está en la papelera de Drive');
            }
            if (!archivo.parents?.includes(carpetaId)) {
              throw new Error('el archivo no quedó en la carpeta de juntas');
            }
            if (archivo.mimeType === 'application/vnd.google-apps.document') {
              throw new Error(
                'el archivo quedó como Google Doc, no como Markdown'
              );
            }
            const bajado = await textoDeArchivo(token, fileId);
            if (!markdownConfirmado(texto, bajado)) {
              throw new Error(
                'el Markdown subido no trae el final de la transcripción'
              );
            }
          },
          indiceLeer: async () => {
            const raiz = deps.cfg().ragDrive?.raizId;
            if (!raiz) {
              return { editable: false, texto: '' };
            }
            const token = await tokenDrive();
            const archivo =
              (await archivoPorNombre(token, raiz, 'INDICE_RAG')) ??
              (await archivoPorNombre(token, raiz, 'INDICE_RAG.md'));
            if (!archivo) {
              indiceId = undefined;
              return { editable: true, texto: '' };
            }
            indiceId = archivo.id;
            if (archivo.mimeType === 'application/vnd.google-apps.document') {
              return { editable: false, texto: '' };
            }
            return {
              editable: true,
              texto: await textoDeArchivo(token, archivo.id)
            };
          },
          indiceGuardar: async (texto) => {
            const raiz = deps.cfg().ragDrive?.raizId;
            if (!raiz) {
              return;
            }
            const token = await tokenDrive();
            if (indiceId) {
              await actualizarMarkdown(token, indiceId, texto, {
                nombre: 'INDICE_RAG.md'
              });
              return;
            }
            const creado = await subirMarkdown(
              token,
              raiz,
              'INDICE_RAG.md',
              texto,
              { rag: 'indice' }
            );
            indiceId = creado.id;
          },
          juntas: () => datos.juntasRag.leer(),
          guardarJunta: async (junta) => {
            const lista = datos.juntasRag
              .leer()
              .filter((j) => j.id !== junta.id);
            lista.push(junta);
            lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
            await datos.juntasRag.escribir(lista);
          },
          actividades: () => datos.crmActividades.leer(),
          guardarActividades: async (lista) => {
            await datos.crmActividades.escribir(lista);
          },
          pendientes: () => datos.personales.leer(),
          guardarPendientes: async (lista) => {
            await datos.personales.escribir(lista);
          },
          borrarFireflies: (firefliesId) => deps.borrar(firefliesId),
          ahora: () => new Date()
        }
      );
    });

  const paraLista = (j: JuntaRag, q: string): JuntaRag =>
    q ? { ...j, texto: j.texto.slice(0, 500) } : { ...j, texto: '' };

  router.get('/juntas-rag', async (contexto) => {
    const quien = actor(contexto);
    const estado = contexto.parametros.get('estado') ?? undefined;
    const proyectoId = contexto.parametros.get('proyectoId') ?? undefined;
    const clienteId = contexto.parametros.get('clienteId') ?? undefined;
    const q = (contexto.parametros.get('q') ?? '').trim();
    const plano = normalizarTexto(q);
    let lista = juntasVisibles(
      datos.juntasRag.leer(),
      quien,
      datos.crmProyectos.leer()
    );
    if (estado === 'sin_asignar' || estado === 'archivada') {
      lista = lista.filter((j) => j.estado === estado);
    }
    if (proyectoId) {
      lista = lista.filter((j) => j.proyectoId === proyectoId);
    }
    if (clienteId) {
      lista = lista.filter((j) => j.clienteId === clienteId);
    }
    if (plano) {
      lista = lista.filter((j) => {
        const bolsa = normalizarTexto(
          [
            j.titulo,
            j.resumen,
            j.texto,
            j.clienteNombre,
            j.proyectoNombre,
            j.participantes.join(' ')
          ]
            .filter(Boolean)
            .join(' ')
        );
        return plano.split(' ').every((p) => bolsa.includes(p));
      });
    }
    return lista.map((j) => paraLista(j, q));
  });

  router.get('/juntas-rag/:id', async (contexto) => {
    const quien = actor(contexto);
    const id = contexto.segmentos[1] ?? '';
    const junta = datos.juntasRag.leer().find((j) => j.id === id);
    if (!junta) {
      throw new ErrorPuente('No encontré esa junta.', 404);
    }
    const visible = juntasVisibles([junta], quien, datos.crmProyectos.leer());
    if (visible.length === 0) {
      throw new ErrorPuente('No tienes permiso para ver esa junta.', 403);
    }
    return junta;
  });

  router.post('/juntas-rag/:id/asignar', async (contexto) => {
    const quien = actor(contexto);
    if (!quien.director) {
      throw new ErrorPuente(
        'Solo el director puede asignar estas juntas.',
        403
      );
    }
    const id = (contexto.segmentos[1] ?? '').trim();
    if (!id) {
      throw new ErrorPuente('Falta el id de la transcripción.', 400);
    }
    const cuerpo = (contexto.cuerpo ?? {}) as Record<string, unknown>;
    const asignacion: AsignacionJunta = {
      clienteId: texto(cuerpo['clienteId']),
      proyectoId: texto(cuerpo['proyectoId']),
      clienteNombre: texto(cuerpo['clienteNombre']),
      proyectoNombre: texto(cuerpo['proyectoNombre'])
    };
    let resultado: ResultadoArchivoRag;
    try {
      resultado = await archivar(id, asignacion);
    } catch (error) {
      throw new ErrorPuente(describir(error), 502);
    }
    if (resultado.estado !== 'archivada') {
      throw new ErrorPuente(
        resultado.motivo ?? 'No se pudo archivar la junta.',
        400
      );
    }
    return resultado;
  });

  deps.programables.push({
    nombre: 'rag de juntas',
    cadaMinutos: REVISION_MINUTOS.juntas,
    correr: async () => {
      if (!deps.cfg().fireflies) {
        return 'omitida';
      }
      let recientes: Transcripcion[];
      try {
        recientes = await deps.listarRecientes();
      } catch (error) {
        console.warn(
          `[puente] RAG: no se pudo leer Fireflies: ${describir(error)}`
        );
        return;
      }
      for (const t of recientes) {
        const junta = datos.juntasRag.leer().find((j) => j.id === t.id);
        if (junta?.driveConfirmado && junta.borradaDeFireflies) {
          continue;
        }
        try {
          const r = await archivar(t.id);
          if (r.estado === 'archivada') {
            console.log(
              `[puente] RAG "${t.titulo}": archivada${r.esItech ? ' (Itech, sin CRM)' : ''}`
            );
          }
        } catch (error) {
          console.warn(`[puente] RAG "${t.titulo}": ${describir(error)}`);
        }
      }
      return;
    }
  });

  return { archivar };
}
