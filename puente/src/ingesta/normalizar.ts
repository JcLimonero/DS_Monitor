import type {
  CrmActivity,
  CrmActivityType,
  CrmOpportunity,
  CrmStage,
  Deployment,
  DeploymentState,
  LicenseUsage,
  Meeting,
  MonitorCheck,
  MonitorTarget,
  Person,
  RepoCheckState,
  RepoPullRequest,
  RepoReviewState,
  RepoStatus,
  TaskItem
} from '../nucleo/contrato.js';
import type {
  ActividadEntrante,
  CrmEntrante,
  DespliegueEntrante,
  JuntaEntrante,
  LicenciaEntrante,
  OportunidadEntrante,
  PendienteEntrante,
  PersonaEntrante,
  RepoEntrante,
  RevisionEntrante
} from './modelos.js';
import {
  booleanoOpcional,
  fechaObligatoria,
  fechaOpcional,
  listaDeObjetos,
  numeroObligatorio,
  numeroOpcional,
  opcionOpcional,
  textoObligatorio,
  textoOpcional
} from './validar.js';

/**
 * Traduce lo recibido al modelo del portal.
 *
 * Cada funcion valida mientras traduce: no hay un paso de validacion y otro de
 * conversion, porque mantener dos recorridos sobre la misma forma es como se
 * desincronizan. Lo que sale de aqui ya cumple el contrato del portal.
 */

const UNA_HORA_MS = 3_600_000;

function persona(valor: unknown, donde: string): Person | undefined {
  if (valor === undefined || valor === null) {
    return undefined;
  }
  if (typeof valor !== 'object' || Array.isArray(valor)) {
    throw new Error(`${donde} debe ser un objeto`);
  }
  const entrante = valor as PersonaEntrante;
  const nombre = textoObligatorio(entrante.nombre, `${donde}.nombre`);
  const correo = textoOpcional(entrante.correo, `${donde}.correo`);
  return {
    id: textoOpcional(entrante.id, `${donde}.id`) ?? correo ?? nombre,
    name: nombre,
    email: correo,
    role: textoOpcional(entrante.rol, `${donde}.rol`)
  };
}

/**
 * Los identificadores llevan prefijo del origen.
 *
 * Sin el, la tarea 1 de Ops y la actividad 1 de Odoo tendrian el mismo id y el
 * portal mostraria solo una de las dos.
 */
function idConOrigen(origen: string, id: string): string {
  return `${origen}-${id}`;
}

// --- Pendientes ---

const ESTADOS_TAREA = [
  'pendiente',
  'en_progreso',
  'bloqueado',
  'hecho'
] as const;
const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'] as const;

export function normalizarPendientes(
  datos: unknown,
  origen: string,
  accountId: string,
  ahora = new Date()
): TaskItem[] {
  return listaDeObjetos(datos, '"datos"').map((crudo, indice) => {
    const entrante = crudo as unknown as PendienteEntrante;
    const donde = `datos[${indice}]`;
    return {
      id: idConOrigen(origen, textoObligatorio(entrante.id, `${donde}.id`)),
      title: textoObligatorio(entrante.titulo, `${donde}.titulo`),
      description: textoOpcional(entrante.descripcion, `${donde}.descripcion`),
      status:
        opcionOpcional(entrante.estado, ESTADOS_TAREA, `${donde}.estado`) ??
        'pendiente',
      priority:
        opcionOpcional(entrante.prioridad, PRIORIDADES, `${donde}.prioridad`) ??
        'media',
      dueDate: fechaOpcional(entrante.venceEn, `${donde}.venceEn`),
      assignee: persona(entrante.responsable, `${donde}.responsable`),
      accountId,
      origin: 'ops',
      project: textoOpcional(entrante.proyecto, `${donde}.proyecto`),
      url: textoOpcional(entrante.url, `${donde}.url`),
      tags: Array.isArray(entrante.etiquetas)
        ? entrante.etiquetas.map((etiqueta, i) =>
            textoObligatorio(etiqueta, `${donde}.etiquetas[${i}]`)
          )
        : [],
      updatedAt:
        fechaOpcional(entrante.actualizadoEn, `${donde}.actualizadoEn`) ??
        ahora.toISOString()
    };
  });
}

// --- Juntas ---

const ESTADOS_JUNTA = ['confirmada', 'tentativa', 'cancelada'] as const;

export function normalizarJuntas(
  datos: unknown,
  origen: string,
  accountId: string
): Meeting[] {
  return listaDeObjetos(datos, '"datos"').map((crudo, indice) => {
    const entrante = crudo as unknown as JuntaEntrante;
    const donde = `datos[${indice}]`;
    const inicio = fechaObligatoria(entrante.inicio, `${donde}.inicio`);
    return {
      id: idConOrigen(origen, textoObligatorio(entrante.id, `${donde}.id`)),
      title: textoObligatorio(entrante.titulo, `${donde}.titulo`),
      start: inicio,
      // Sin fin, se asume una hora: dejar la junta sin duracion la haria
      // invisible en la linea de tiempo de la agenda.
      end:
        fechaOpcional(entrante.fin, `${donde}.fin`) ??
        new Date(new Date(inicio).getTime() + UNA_HORA_MS).toISOString(),
      allDay:
        booleanoOpcional(entrante.todoElDia, `${donde}.todoElDia`) ?? false,
      accountId,
      status:
        opcionOpcional(entrante.estado, ESTADOS_JUNTA, `${donde}.estado`) ??
        'confirmada',
      organizer: persona(entrante.organizador, `${donde}.organizador`),
      attendees: Array.isArray(entrante.asistentes)
        ? entrante.asistentes
            .map((asistente, i) =>
              persona(asistente, `${donde}.asistentes[${i}]`)
            )
            .filter((asistente): asistente is Person => asistente !== undefined)
        : [],
      location: textoOpcional(entrante.lugar, `${donde}.lugar`),
      joinUrl: textoOpcional(entrante.enlace, `${donde}.enlace`),
      notes: textoOpcional(entrante.notas, `${donde}.notas`)
    };
  });
}

// --- Monitoreo ---

const TIPOS_DESTINO = ['sitio', 'api', 'servicio', 'proceso'] as const;
const ENTORNOS = ['produccion', 'pruebas', 'desarrollo'] as const;

/** Cuantas revisiones conserva el historial de cada destino. */
export const MAXIMO_HISTORIAL = 48;

/** Arriba de esto se considera degradado aunque haya respondido. */
const LATENCIA_DEGRADADO_MS = 1_000;

export interface RevisionNormalizada {
  destino: Omit<MonitorTarget, 'history' | 'uptime24h' | 'uptime30d'>;
  revision: MonitorCheck;
}

export function normalizarRevisiones(
  datos: unknown,
  accountId: string,
  ahora = new Date()
): RevisionNormalizada[] {
  return listaDeObjetos(datos, '"datos"').map((crudo, indice) => {
    const entrante = crudo as unknown as RevisionEntrante;
    const donde = `datos[${indice}]`;
    const ok = booleanoOpcional(entrante.ok, `${donde}.ok`);
    if (ok === undefined) {
      throw new Error(`${donde}.ok es obligatorio`);
    }
    const latencia =
      numeroOpcional(entrante.latenciaMs, `${donde}.latenciaMs`) ?? 0;
    const enMantenimiento =
      booleanoOpcional(entrante.enMantenimiento, `${donde}.enMantenimiento`) ??
      false;

    const estado = enMantenimiento
      ? 'mantenimiento'
      : !ok
        ? 'caido'
        : latencia >= LATENCIA_DEGRADADO_MS
          ? 'degradado'
          : 'operativo';

    const revisadoEn =
      fechaOpcional(entrante.revisadoEn, `${donde}.revisadoEn`) ??
      ahora.toISOString();

    return {
      destino: {
        id: textoObligatorio(entrante.id, `${donde}.id`),
        name: textoObligatorio(entrante.nombre, `${donde}.nombre`),
        kind:
          opcionOpcional(entrante.tipo, TIPOS_DESTINO, `${donde}.tipo`) ??
          'sitio',
        url: textoObligatorio(entrante.url, `${donde}.url`),
        environment:
          opcionOpcional(entrante.entorno, ENTORNOS, `${donde}.entorno`) ??
          'produccion',
        status: estado,
        latencyMs: ok ? latencia : undefined,
        lastCheck: revisadoEn,
        incident: textoOpcional(entrante.incidente, `${donde}.incidente`),
        accountId
      },
      revision: {
        at: revisadoEn,
        ok,
        latencyMs: latencia,
        statusCode: numeroOpcional(entrante.codigo, `${donde}.codigo`)
      }
    };
  });
}

// --- CRM ---

/** Se acepta el nombre de etapa de cada instancia y se compara por palabras. */
export function etapaCrm(nombre: string | undefined): CrmStage {
  const limpio = (nombre ?? '').toLowerCase();
  if (limpio.includes('gana')) {
    return 'ganado';
  }
  if (limpio.includes('perdi')) {
    return 'perdido';
  }
  if (limpio.includes('negocia')) {
    return 'negociacion';
  }
  if (limpio.includes('propuesta') || limpio.includes('cotiza')) {
    return 'propuesta';
  }
  if (limpio.includes('calific')) {
    return 'calificado';
  }
  return 'nuevo';
}

export function tipoActividadCrm(nombre: string | undefined): CrmActivityType {
  const limpio = (nombre ?? '').toLowerCase();
  if (limpio.includes('llamada') || limpio.includes('call')) {
    return 'llamada';
  }
  if (limpio.includes('correo') || limpio.includes('mail')) {
    return 'correo';
  }
  if (limpio.includes('reuni') || limpio.includes('meeting')) {
    return 'reunion';
  }
  return 'tarea';
}

export function normalizarCrm(
  datos: unknown,
  origen: string,
  accountId: string,
  ahora = new Date()
): { oportunidades: CrmOpportunity[]; actividades: CrmActivity[] } {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    throw new Error(
      '"datos" debe ser un objeto con "oportunidades" y/o "actividades"'
    );
  }
  const entrante = datos as CrmEntrante;

  const oportunidades = (entrante.oportunidades ?? []).map(
    (crudo: OportunidadEntrante, indice) => {
      const donde = `datos.oportunidades[${indice}]`;
      return {
        id: idConOrigen(origen, textoObligatorio(crudo.id, `${donde}.id`)),
        name: textoObligatorio(crudo.nombre, `${donde}.nombre`),
        partner: textoObligatorio(crudo.cliente, `${donde}.cliente`),
        stage: etapaCrm(textoOpcional(crudo.etapa, `${donde}.etapa`)),
        amount: numeroOpcional(crudo.importe, `${donde}.importe`) ?? 0,
        currency: textoOpcional(crudo.moneda, `${donde}.moneda`) ?? 'MXN',
        probability: Math.round(
          numeroOpcional(crudo.probabilidad, `${donde}.probabilidad`) ?? 0
        ),
        expectedClose: fechaOpcional(
          crudo.cierreEsperado,
          `${donde}.cierreEsperado`
        ),
        salesperson: persona(crudo.vendedor, `${donde}.vendedor`),
        accountId,
        url: textoOpcional(crudo.url, `${donde}.url`),
        updatedAt:
          fechaOpcional(crudo.actualizadoEn, `${donde}.actualizadoEn`) ??
          ahora.toISOString()
      };
    }
  );

  const actividades = (entrante.actividades ?? []).map(
    (crudo: ActividadEntrante, indice) => {
      const donde = `datos.actividades[${indice}]`;
      return {
        id: idConOrigen(origen, textoObligatorio(crudo.id, `${donde}.id`)),
        summary: textoObligatorio(crudo.resumen, `${donde}.resumen`),
        type: tipoActividadCrm(textoOpcional(crudo.tipo, `${donde}.tipo`)),
        dueDate: fechaObligatoria(crudo.venceEn, `${donde}.venceEn`),
        responsible: persona(crudo.responsable, `${donde}.responsable`),
        opportunityId: crudo.oportunidadId
          ? idConOrigen(
              origen,
              textoObligatorio(crudo.oportunidadId, `${donde}.oportunidadId`)
            )
          : undefined,
        opportunityName: textoOpcional(
          crudo.oportunidadNombre,
          `${donde}.oportunidadNombre`
        ),
        accountId,
        url: textoOpcional(crudo.url, `${donde}.url`)
      };
    }
  );

  return { oportunidades, actividades };
}

// --- Licencias ---

const PROVEEDORES = ['anthropic', 'cursor', 'figma', 'vercel', 'otro'] as const;
const UNIDADES = ['asientos', 'tokens', 'solicitudes', 'dinero'] as const;

export function normalizarLicencias(
  datos: unknown,
  accountId: string,
  ahora = new Date()
): LicenseUsage[] {
  return listaDeObjetos(datos, '"datos"').map((crudo, indice) => {
    const entrante = crudo as unknown as LicenciaEntrante;
    const donde = `datos[${indice}]`;
    return {
      id: textoObligatorio(entrante.id, `${donde}.id`),
      provider:
        opcionOpcional(entrante.proveedor, PROVEEDORES, `${donde}.proveedor`) ??
        'otro',
      product: textoObligatorio(entrante.producto, `${donde}.producto`),
      plan: textoOpcional(entrante.plan, `${donde}.plan`),
      unit:
        opcionOpcional(entrante.unidad, UNIDADES, `${donde}.unidad`) ??
        'asientos',
      used: numeroObligatorio(entrante.usado, `${donde}.usado`),
      limit: numeroOpcional(entrante.tope, `${donde}.tope`),
      periodStart:
        fechaOpcional(entrante.periodoInicio, `${donde}.periodoInicio`) ??
        inicioDeMes(ahora),
      periodEnd:
        fechaOpcional(entrante.periodoFin, `${donde}.periodoFin`) ??
        finDeMes(ahora),
      cost: numeroOpcional(entrante.costo, `${donde}.costo`),
      currency: textoOpcional(entrante.moneda, `${donde}.moneda`),
      renewsAt: fechaOpcional(entrante.renuevaEn, `${donde}.renuevaEn`),
      // Lo que llega por envio suele venir de una hoja o un script propio, no
      // del proveedor; se marca como manual salvo que digan lo contrario.
      manual:
        booleanoOpcional(entrante.capturadoAMano, `${donde}.capturadoAMano`) ??
        true,
      members: (entrante.miembros ?? []).map((miembro, i) => {
        const dondeMiembro = `${donde}.miembros[${i}]`;
        const quien = persona(miembro.persona, `${dondeMiembro}.persona`);
        if (!quien) {
          throw new Error(`${dondeMiembro}.persona es obligatorio`);
        }
        return {
          person: quien,
          used: numeroOpcional(miembro.usado, `${dondeMiembro}.usado`) ?? 1,
          active:
            booleanoOpcional(miembro.activo, `${dondeMiembro}.activo`) ?? true
        };
      }),
      accountId,
      url: textoOpcional(entrante.url, `${donde}.url`),
      updatedAt: ahora.toISOString()
    };
  });
}

function inicioDeMes(ahora: Date): string {
  return new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)
  ).toISOString();
}

function finDeMes(ahora: Date): string {
  return new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 1)
  ).toISOString();
}

// --- Despliegues ---

const ENTORNOS_DESPLIEGUE = ['produccion', 'vista_previa'] as const;

/**
 * Acepta el vocabulario de cualquier proveedor.
 *
 * Lo que no reconoce se reporta como en cola, nunca como listo: pintar de verde
 * algo que no sabemos que termino es el peor error que puede cometer un tablero.
 */
export function estadoDespliegueEntrante(crudo: string): DeploymentState {
  const limpio = crudo.toLowerCase();
  if (
    ['ready', 'listo', 'success', 'succeeded', 'exitoso', 'deployed'].includes(
      limpio
    )
  ) {
    return 'listo';
  }
  if (
    ['building', 'construyendo', 'in_progress', 'running', 'pending'].includes(
      limpio
    )
  ) {
    return 'construyendo';
  }
  if (['queued', 'en_cola', 'waiting'].includes(limpio)) {
    return 'en_cola';
  }
  if (['error', 'failed', 'failure', 'fallido'].includes(limpio)) {
    return 'error';
  }
  if (['canceled', 'cancelled', 'cancelado', 'skipped'].includes(limpio)) {
    return 'cancelado';
  }
  return 'en_cola';
}

export function normalizarDespliegues(
  datos: unknown,
  origen: string,
  accountId: string
): Deployment[] {
  return listaDeObjetos(datos, '"datos"').map((crudo, indice) => {
    const entrante = crudo as unknown as DespliegueEntrante;
    const donde = `datos[${indice}]`;
    const creado = fechaObligatoria(entrante.creadoEn, `${donde}.creadoEn`);
    const listo = fechaOpcional(entrante.listoEn, `${donde}.listoEn`);
    return {
      id: idConOrigen(origen, textoObligatorio(entrante.id, `${donde}.id`)),
      project: textoObligatorio(entrante.proyecto, `${donde}.proyecto`),
      url: textoOpcional(entrante.url, `${donde}.url`) ?? '',
      state: estadoDespliegueEntrante(
        textoObligatorio(entrante.estado, `${donde}.estado`)
      ),
      environment:
        opcionOpcional(
          entrante.entorno,
          ENTORNOS_DESPLIEGUE,
          `${donde}.entorno`
        ) ?? 'vista_previa',
      branch: textoOpcional(entrante.rama, `${donde}.rama`),
      commitSha: textoOpcional(entrante.commit, `${donde}.commit`)?.slice(0, 7),
      commitMessage: textoOpcional(entrante.mensaje, `${donde}.mensaje`),
      author: persona(entrante.autor, `${donde}.autor`),
      createdAt: creado,
      readyAt: listo,
      durationSeconds:
        numeroOpcional(
          entrante.duracionSegundos,
          `${donde}.duracionSegundos`
        ) ??
        (listo
          ? Math.max(
              0,
              Math.round(
                (new Date(listo).getTime() - new Date(creado).getTime()) / 1000
              )
            )
          : undefined),
      inspectorUrl: textoOpcional(
        entrante.enlaceDetalle,
        `${donde}.enlaceDetalle`
      ),
      accountId
    };
  });
}

// --- Repositorios ---

const INTEGRACIONES = [
  'exitoso',
  'fallido',
  'en_curso',
  'sin_revision'
] as const;
const REVISIONES = ['aprobado', 'cambios_solicitados', 'sin_revisar'] as const;

export function normalizarRepos(
  datos: unknown,
  accountId: string,
  ahora = new Date()
): RepoStatus[] {
  return listaDeObjetos(datos, '"datos"').map((crudo, indice) => {
    const entrante = crudo as unknown as RepoEntrante;
    const donde = `datos[${indice}]`;
    const nombre = textoObligatorio(entrante.nombre, `${donde}.nombre`);

    return {
      id: nombre,
      name: nombre,
      url: textoObligatorio(entrante.url, `${donde}.url`),
      private: booleanoOpcional(entrante.privado, `${donde}.privado`) ?? true,
      defaultBranch:
        textoOpcional(entrante.ramaPrincipal, `${donde}.ramaPrincipal`) ??
        'main',
      lastCommit: entrante.ultimoCommit
        ? {
            sha: textoObligatorio(
              entrante.ultimoCommit.sha,
              `${donde}.ultimoCommit.sha`
            ).slice(0, 7),
            message: textoOpcional(
              entrante.ultimoCommit.mensaje,
              `${donde}.ultimoCommit.mensaje`
            ),
            author: persona(
              entrante.ultimoCommit.autor,
              `${donde}.ultimoCommit.autor`
            ),
            at: fechaObligatoria(
              entrante.ultimoCommit.fecha,
              `${donde}.ultimoCommit.fecha`
            ),
            url: textoOpcional(
              entrante.ultimoCommit.url,
              `${donde}.ultimoCommit.url`
            )
          }
        : undefined,
      checkState:
        (opcionOpcional(
          entrante.integracion,
          INTEGRACIONES,
          `${donde}.integracion`
        ) as RepoCheckState) ?? 'sin_revision',
      openPullRequests: (entrante.pullRequests ?? []).map((pr, i) => {
        const dondePr = `${donde}.pullRequests[${i}]`;
        return {
          number: numeroObligatorio(pr.numero, `${dondePr}.numero`),
          title: textoObligatorio(pr.titulo, `${dondePr}.titulo`),
          url: textoObligatorio(pr.url, `${dondePr}.url`),
          author: persona(pr.autor, `${dondePr}.autor`),
          createdAt: fechaObligatoria(pr.creadoEn, `${dondePr}.creadoEn`),
          updatedAt: fechaOpcional(
            pr.actualizadoEn,
            `${dondePr}.actualizadoEn`
          ),
          draft: booleanoOpcional(pr.borrador, `${dondePr}.borrador`) ?? false,
          reviewState:
            (opcionOpcional(
              pr.revision,
              REVISIONES,
              `${dondePr}.revision`
            ) as RepoReviewState) ?? 'sin_revisar',
          checkState:
            (opcionOpcional(
              pr.integracion,
              INTEGRACIONES,
              `${dondePr}.integracion`
            ) as RepoCheckState) ?? 'sin_revision'
        } satisfies RepoPullRequest;
      }),
      openIssues:
        numeroOpcional(entrante.issuesAbiertos, `${donde}.issuesAbiertos`) ?? 0,
      pushedAt: fechaOpcional(entrante.ultimoPushEn, `${donde}.ultimoPushEn`),
      accountId,
      updatedAt: ahora.toISOString()
    };
  });
}
