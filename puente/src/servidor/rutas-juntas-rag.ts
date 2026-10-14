import type { Configuracion } from '../config/entorno.js';
import type { AlmacenTabla } from '../datos/almacen-tabla.js';
import type {
  CrmProyecto,
  JuntaRag,
  RolCrm,
  UsuarioCrm
} from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import { normalizarTexto } from '../proveedores/fireflies.js';
import { actorDe, juntasVisibles, type ActorJunta } from '../rag/permisos.js';
import {
  ROLES_FABRICA,
  buscarUsuarioPorCorreo,
  esDirector,
  permisosEfectivos,
  usuarioDirector
} from '../datos/roles-permisos.js';
import type { Contexto, Router } from './router.js';

export interface DatosJuntasRag {
  juntasRag: AlmacenTabla<JuntaRag[]>;
  crmProyectos: AlmacenTabla<CrmProyecto[]>;
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
}

/**
 * Lectura historica de juntas_rag. El Markdown a Drive y el programable
 * «rag de juntas» ya no corren aqui: lo hace una rutina externa. El RAG
 * vectorial (buscar, preguntar, reconciliar) vive en rutas-rag.ts.
 */
export function registrarJuntasRag(deps: DependenciasJuntasRag): void {
  const { router, datos } = deps;

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
}
