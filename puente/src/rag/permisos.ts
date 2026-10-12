import {
  esDirector,
  permisosEfectivos,
  proyectoEnAlcance,
  tienePermiso,
  type RolCrm,
  type UsuarioCrm
} from '../datos/roles-permisos.js';
import type { AreaPermiso, JuntaRag, NivelAcceso } from '../nucleo/contrato.js';

export interface ProyectoPermiso {
  id: string;
  clienteId: string;
  empresaAtiendeId?: string;
}

export interface ActorJunta {
  director: boolean;
  usuario?: UsuarioCrm;
  permisos: Record<AreaPermiso, NivelAcceso>;
}

/**
 * Quien puede ver una junta guardada.
 *
 * El director ve la bandeja y todo lo archivado. El resto solo ve juntas
 * archivadas de proyectos dentro de su alcance. Itech no tiene proyecto de
 * CRM: la ve quien no trae alcance (y el director).
 */
export function juntaVisible(
  junta: JuntaRag,
  actor: ActorJunta,
  proyectos: readonly ProyectoPermiso[]
): boolean {
  if (actor.director || esDirector(actor.permisos)) {
    return true;
  }
  const usuario = actor.usuario;
  if (!usuario?.activo) {
    return false;
  }
  const puede =
    tienePermiso(actor.permisos, 'proyectos', 'lectura') ||
    tienePermiso(actor.permisos, 'actividades', 'lectura');
  if (!puede) {
    return false;
  }
  if (junta.estado === 'sin_asignar') {
    return false;
  }
  if (junta.esItech || !junta.proyectoId) {
    return !usuario.alcance;
  }
  const proyecto = proyectos.find((p) => p.id === junta.proyectoId);
  if (!proyecto) {
    return !usuario.alcance;
  }
  return proyectoEnAlcance(
    proyecto.id,
    proyecto.clienteId,
    proyecto.empresaAtiendeId,
    usuario.alcance
  );
}

export function juntasVisibles(
  juntas: readonly JuntaRag[],
  actor: ActorJunta,
  proyectos: readonly ProyectoPermiso[]
): JuntaRag[] {
  return juntas.filter((j) => juntaVisible(j, actor, proyectos));
}

export function actorDe(usuario: UsuarioCrm, roles: RolCrm[]): ActorJunta {
  const permisos = permisosEfectivos(usuario, roles);
  return {
    director: esDirector(permisos),
    usuario,
    permisos
  };
}
