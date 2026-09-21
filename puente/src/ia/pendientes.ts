import type { ConfiguracionIa } from '../config/entorno.js';
import type { TaskItem, TaskPriority } from '../nucleo/contrato.js';
import { correoDelRemitente } from '../pendientes/remitente.js';
import {
  contextoEmpresas,
  empresaValida,
  opcionesEmpresa
} from '../datos/empresas.js';
import { comoJson, preguntar, texto1 } from './modelo.js';

/**
 * Empresa y prioridad para los pendientes que llegan sin ellas: los de la API
 * de Ops, los del barrido, los personales que se apuntan a la carrera. Se
 * clasifican una vez por id y el veredicto se guarda; solo se mandan los
 * nuevos.
 */
export interface VeredictoPendiente {
  id: string;
  empresa?: string;
  prioridad?: TaskPriority;
  analizadoEn: string;
}

export async function clasificarPendientes(
  config: ConfiguracionIa,
  tareas: TaskItem[],
  ahora = new Date()
): Promise<VeredictoPendiente[]> {
  if (tareas.length === 0) {
    return [];
  }
  const texto = await preguntar(config, {
    uso: 'pendientes',
    sistema: `${contextoEmpresas()}\nTe doy pendientes (título, descripción, proyecto, etiquetas, origen). Para cada uno di a qué empresa pertenece y qué prioridad merece. Responde SOLO JSON: {"pendientes":[{"id":"...","empresa":"${opcionesEmpresa()}","prioridad":"baja|media|alta|urgente"}]}. Urgente si hay dinero, cliente o servicio en riesgo o vence en menos de 2 días; alta si es de esta semana; media por omisión; baja si es opcional.`,
    usuario: JSON.stringify({
      hoy: ahora.toISOString().slice(0, 10),
      pendientes: tareas.map((t) => ({
        id: t.id,
        titulo: t.title,
        descripcion: (t.description ?? '').slice(0, 300),
        proyecto: t.project,
        etiquetas: t.tags,
        origen: t.origin,
        vence: t.dueDate?.slice(0, 10),
        prioridadActual: t.priority
      }))
    }),
    json: true,
    maxTokens: 2500
  });
  const salida = comoJson<{ pendientes?: Partial<VeredictoPendiente>[] }>(
    texto
  );
  const porId = new Map(
    (Array.isArray(salida.pendientes) ? salida.pendientes : []).map((p) => [
      p.id,
      p
    ])
  );
  return tareas.map((t) => {
    const v = porId.get(t.id);
    return {
      id: t.id,
      empresa: empresaValida(v?.empresa),
      prioridad: (['baja', 'media', 'alta', 'urgente'] as const).find(
        (p) => p === texto1(v?.prioridad)
      ),
      analizadoEn: ahora.toISOString()
    };
  });
}

/** Pone empresa y prioridad de los veredictos sobre las tareas. */
export function aplicarVeredictos(
  tareas: TaskItem[],
  veredictos: Record<string, VeredictoPendiente>
): TaskItem[] {
  return tareas.map((t) => {
    const v = veredictos[t.id];
    if (!v) {
      return t;
    }
    return {
      ...t,
      company: t.company ?? v.empresa,
      // La prioridad la sube la IA, no la baja: lo que alguien marco urgente
      // a mano se respeta.
      priority: masAlta(t.priority, v.prioridad)
    };
  });
}

const ORDEN: TaskPriority[] = ['baja', 'media', 'alta', 'urgente'];

function masAlta(a: TaskPriority, b?: TaskPriority): TaskPriority {
  if (!b) {
    return a;
  }
  return ORDEN.indexOf(b) > ORDEN.indexOf(a) ? b : a;
}

/** Que tan segura viene la propuesta; solo con "alta" se asigna sin preguntar. */
export type ConfianzaSugerencia = 'alta' | 'media' | 'baja';

/** Lo que la IA propone para un pendiente sin dueño: quién y de qué empresa. */
export interface SugerenciaPendiente {
  responsable?: string;
  empresa?: string;
  motivo: string;
  confianza: ConfianzaSugerencia;
}

/** El dueño del buzón por el que llegó el correo: a quien va dirigido todo. */
export interface DuenoDelBuzon {
  correo?: string;
  nombre?: string;
}

/** Los correos de la linea "Para:" que guarda la descripcion del pendiente. */
export function correosDelPara(descripcion: string | undefined): string[] {
  const para = /^Para: (.+)$/m.exec(descripcion ?? '')?.[1] ?? '';
  return [
    ...new Set(
      (para.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((c) =>
        c.trim().toLowerCase()
      )
    )
  ];
}

/**
 * Ser el dueño del buzón no es evidencia: todos los correos van dirigidos a
 * él. Si la propuesta es el dueño (mismo correo que el buzón o que el "Para:"
 * del correo), la confianza se queda en "media" como mucho: sugerencia,
 * nunca asignación automática.
 */
export function acotarConfianza(
  sugerencia: SugerenciaPendiente,
  equipo: readonly { id: string; email?: string }[],
  dueno: DuenoDelBuzon | undefined,
  paraDelCorreo: readonly string[] = []
): SugerenciaPendiente {
  if (!sugerencia.responsable || sugerencia.confianza !== 'alta') {
    return sugerencia;
  }
  const correo = equipo
    .find((p) => p.id === sugerencia.responsable)
    ?.email?.trim()
    .toLowerCase();
  if (!correo) {
    return sugerencia;
  }
  const duenos = new Set(
    [dueno?.correo, ...paraDelCorreo]
      .filter((c): c is string => !!c)
      .map((c) => c.trim().toLowerCase())
  );
  if (!duenos.has(correo)) {
    return sugerencia;
  }
  return {
    ...sugerencia,
    confianza: 'media',
    motivo: `${sugerencia.motivo} (es el dueño del buzón: queda como sugerencia)`
  };
}

/**
 * Sugiere responsable y empresa para un pendiente: a pedido (el botón en la
 * tarjeta) o al registrar uno nuevo del correo. Se apoya en el equipo, en lo
 * que otros pendientes parecidos ya tienen asignado y en lo aprendido de
 * correcciones anteriores por remitente. Dice ademas que tan segura es la
 * propuesta: alta solo si hay una base concreta (regla aprendida, un parecido
 * del mismo remitente o proyecto ya con esa persona, o el correo la nombra).
 * Ser el dueño del buzón no cuenta: proponerlo es "media" o "baja", y ademas
 * se acota en codigo (`acotarConfianza`). Quien llama decide si asigna o
 * solo sugiere.
 */
export async function sugerirResponsable(
  config: ConfiguracionIa,
  tarea: TaskItem,
  equipo: { id: string; name: string; role?: string; email?: string }[],
  parecidos: TaskItem[],
  pistas: string[],
  duenoDelBuzon?: DuenoDelBuzon
): Promise<SugerenciaPendiente> {
  const paraDelCorreo = correosDelPara(tarea.description);
  const texto = await preguntar(config, {
    uso: 'asistente',
    sistema: `${contextoEmpresas()}\nTe doy un pendiente sin responsable, el equipo (nombre y rol), pendientes parecidos que ya tienen responsable y empresa, pistas aprendidas por remitente y quién es el dueño del buzón por el que llegó. Propón quién del equipo debería atenderlo y a qué empresa pertenece. Responde SOLO JSON: {"responsable":"id de la persona o null","empresa":"${opcionesEmpresa()}","motivo":"una frase corta de por qué","confianza":"alta|media|baja"}. IMPORTANTE: todos los correos van dirigidos al dueño del buzón, así que ser el destinatario (el "Para:") NO es evidencia de nada; nunca uses "es el destinatario del correo" como motivo. La confianza es "alta" SOLO si (1) hay una regla aprendida para ese remitente, (2) un pendiente parecido del mismo remitente o proyecto ya está con esa persona, o (3) el cuerpo del correo nombra explícitamente a alguien del equipo por su nombre o correo (distinto del dueño del buzón) para que lo atienda. Proponer al dueño del buzón solo puede ser "media" o "baja" (queda como sugerencia, nunca se asigna solo). "media" si lo deduces por el rol o la empresa; "baja" si es una corazonada. Si no hay base para proponer, responsable null, confianza baja y dilo en el motivo.`,
    usuario: JSON.stringify({
      pendiente: {
        titulo: tarea.title,
        descripcion: (tarea.description ?? '').slice(0, 600),
        proyecto: tarea.project,
        empresaActual: tarea.company,
        origen: tarea.origin,
        remitente: tarea.senderKind,
        correoRemitente: correoDelRemitente(tarea.description),
        para: paraDelCorreo,
        etiquetas: tarea.tags
      },
      duenoDelBuzon: duenoDelBuzon ?? { correo: paraDelCorreo[0] },
      equipo,
      parecidos: parecidos.slice(0, 12).map((t) => ({
        titulo: t.title,
        empresa: t.company,
        proyecto: t.project,
        correoRemitente: correoDelRemitente(t.description),
        responsable: t.assignee?.id
      })),
      pistas: pistas.slice(0, 25)
    }),
    json: true,
    maxTokens: 400
  });
  const salida = comoJson<Partial<SugerenciaPendiente>>(texto);
  const responsable = texto1(salida.responsable);
  const valido = equipo.some((p) => p.id === responsable);
  return acotarConfianza(
    {
      responsable: valido ? responsable : undefined,
      empresa: empresaValida(salida.empresa),
      motivo: texto1(salida.motivo) ?? 'Sin base suficiente para proponer.',
      confianza:
        (valido &&
          (['alta', 'media', 'baja'] as const).find(
            (c) => c === texto1(salida.confianza)
          )) ||
        'baja'
    },
    equipo,
    duenoDelBuzon,
    paraDelCorreo
  );
}
