import type { ConfiguracionIa } from '../config/entorno.js';
import type { TaskItem, TaskPriority } from '../nucleo/contrato.js';
import {
  CONTEXTO_EMPRESAS,
  EMPRESAS,
  comoJson,
  preguntar,
  texto1
} from './modelo.js';

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
    sistema: `${CONTEXTO_EMPRESAS}\nTe doy pendientes (título, descripción, proyecto, etiquetas, origen). Para cada uno di a qué empresa pertenece y qué prioridad merece. Responde SOLO JSON: {"pendientes":[{"id":"...","empresa":"Itech Dev|Dealer Solutions|NexusQTech|OperativAI|null","prioridad":"baja|media|alta|urgente"}]}. Urgente si hay dinero, cliente o servicio en riesgo o vence en menos de 2 días; alta si es de esta semana; media por omisión; baja si es opcional.`,
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
      empresa: EMPRESAS.find((e) => e === v?.empresa),
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
