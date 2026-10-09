import type { CrmStage, Person, TaskItem } from '../nucleo/contrato.js';

/**
 * Cotizaciones abiertas sin movimiento: cuando una lleva mas tiempo quieta
 * del que se espera para su etapa, el puente crea UN pendiente propio para
 * revisarla. Aqui vive la decision (pura); el reloj, el almacen y los avisos
 * estan en `servidor/rutas-cotizaciones.ts`.
 */

export type EtapaVigilada =
  'nuevo' | 'calificado' | 'propuesta' | 'negociacion';

export const ETAPAS_VIGILADAS: EtapaVigilada[] = [
  'nuevo',
  'calificado',
  'propuesta',
  'negociacion'
];

/** Dias quieta antes de crear el pendiente, por etapa. 0 = no se vigila. */
export type DiasPorEtapa = Record<EtapaVigilada, number>;

export const DIAS_POR_OMISION: DiasPorEtapa = {
  nuevo: 1,
  calificado: 2,
  propuesta: 3,
  negociacion: 5
};

export interface AjustesCotizaciones {
  /** Solo lo que se cambio; el resto usa DIAS_POR_OMISION. */
  dias: Partial<DiasPorEtapa>;
  actualizadoEn?: string;
}

export const AJUSTES_COTIZACIONES_VACIOS: AjustesCotizaciones = { dias: {} };

const DIA_MS = 86_400_000;
const MAXIMO_DIAS = 365;

/** Los limites vigentes: lo guardado encima de lo de fabrica. */
export function diasVigentes(ajustes: AjustesCotizaciones): DiasPorEtapa {
  return { ...DIAS_POR_OMISION, ...ajustes.dias };
}

/**
 * Valida lo que manda el portal o la automatizacion. Cada etapa es un numero
 * entero de 0 a 365 (0 = no vigilar esa etapa) o `null` para volver al valor
 * de fabrica. Lo que no viene no se toca.
 */
export function validarAjustes(
  crudo: unknown,
  previo: AjustesCotizaciones,
  ahora = new Date()
): AjustesCotizaciones {
  const entrada = ((crudo ?? {}) as { dias?: unknown }).dias;
  if (
    typeof entrada !== 'object' ||
    entrada === null ||
    Array.isArray(entrada)
  ) {
    throw new Error('"dias" debe ser un objeto con las etapas a cambiar.');
  }
  const dias: Partial<DiasPorEtapa> = { ...previo.dias };
  for (const [etapa, valor] of Object.entries(entrada)) {
    if (!ETAPAS_VIGILADAS.includes(etapa as EtapaVigilada)) {
      throw new Error(
        `"${etapa}" no es una etapa vigilada (${ETAPAS_VIGILADAS.join(', ')}).`
      );
    }
    if (valor === null) {
      delete dias[etapa as EtapaVigilada];
      continue;
    }
    if (
      typeof valor !== 'number' ||
      !Number.isInteger(valor) ||
      valor < 0 ||
      valor > MAXIMO_DIAS
    ) {
      throw new Error(
        `Los días de "${etapa}" deben ser un entero de 0 a ${MAXIMO_DIAS}.`
      );
    }
    dias[etapa as EtapaVigilada] = valor;
  }
  return { dias, actualizadoEn: ahora.toISOString() };
}

/** Lo que la tarea necesita saber de una cotizacion. */
export interface CotizacionVigilada {
  emisor: string;
  /** El id con prefijo del emisor. */
  id: string;
  nombre: string;
  cliente: string;
  /** La etapa servida (la manual mientras el emisor no la confirme). */
  etapa: CrmStage;
  vendedor?: Person;
  url?: string;
  accountId: string;
  /** Cuando se movio por ultima vez. */
  ultimoMovimiento: string;
  /** El movimiento con el que ya se creo un pendiente, si se creo. */
  pendienteDesde?: string;
}

export type Decision =
  | { accion: 'ninguna' }
  /** No existe el pendiente, o existe pero ya esta hecho y hubo movimiento. */
  | { accion: 'crear'; dias: number }
  | { accion: 'cerrar'; motivo: string };

export function idDePendiente(idOportunidad: string): string {
  return `cotizacion-${idOportunidad}`;
}

export function diasQuieta(c: CotizacionVigilada, ahora: Date): number {
  return Math.floor(
    (ahora.getTime() - Date.parse(c.ultimoMovimiento)) / DIA_MS
  );
}

/**
 * Que hacer con una cotizacion en esta pasada.
 *
 * - Ganada, perdida o sin limite: si el pendiente sigue abierto, se cierra.
 * - Hubo un movimiento despues de crear el pendiente: si sigue abierto, se
 *   cierra (la cotizacion ya se atendio). Si vuelve a vencer, se crea otro
 *   (se reabre el mismo, mismo id).
 * - Vencida y todavia sin pendiente para ESTE movimiento: se crea. Si alguien
 *   lo marco hecho o lo borro a mano, no se recrea hasta un nuevo movimiento.
 *
 * `abierto` es el pendiente tal como lo ve el usuario (con anotaciones): si
 * esta hecho o borrado, `abierto` es `false`; si no existe, `undefined`.
 */
export function decidir(
  c: CotizacionVigilada,
  abierto: boolean | undefined,
  ajustes: AjustesCotizaciones,
  ahora: Date
): Decision {
  const limite =
    c.etapa === 'ganado' || c.etapa === 'perdido'
      ? 0
      : (diasVigentes(ajustes)[c.etapa as EtapaVigilada] ?? 0);
  if (limite <= 0) {
    return abierto
      ? {
          accion: 'cerrar',
          motivo:
            c.etapa === 'ganado' || c.etapa === 'perdido'
              ? `La cotización quedó en ${c.etapa}`
              : 'Ya no se vigila esta etapa'
        }
      : { accion: 'ninguna' };
  }
  const nuevoMovimiento =
    c.pendienteDesde !== undefined &&
    Date.parse(c.ultimoMovimiento) > Date.parse(c.pendienteDesde);
  if (nuevoMovimiento && abierto) {
    return { accion: 'cerrar', motivo: 'La cotización tuvo movimiento' };
  }
  const vencida =
    ahora.getTime() - Date.parse(c.ultimoMovimiento) >= limite * DIA_MS;
  if (!vencida) {
    return { accion: 'ninguna' };
  }
  if (c.pendienteDesde === undefined || nuevoMovimiento) {
    return { accion: 'crear', dias: Math.max(diasQuieta(c, ahora), limite) };
  }
  return { accion: 'ninguna' };
}

const ETIQUETA_ETAPA: Record<CrmStage, string> = {
  nuevo: 'nuevo',
  calificado: 'calificado',
  propuesta: 'propuesta',
  negociacion: 'negociación',
  ganado: 'ganado',
  perdido: 'perdido'
};

export function tituloDelPendiente(
  c: CotizacionVigilada,
  dias: number
): string {
  const unidad = dias === 1 ? 'día' : 'días';
  return `Revisar cotización ${c.nombre} (${c.cliente}): lleva ${dias} ${unidad} en ${ETIQUETA_ETAPA[c.etapa]}`.slice(
    0,
    160
  );
}

/** El pendiente propio del puente para una cotizacion vencida. */
export function pendienteDeCotizacion(
  c: CotizacionVigilada,
  dias: number,
  ahora: Date
): TaskItem {
  const desde = new Date(c.ultimoMovimiento).toLocaleDateString('es-MX', {
    dateStyle: 'medium',
    timeZone: 'America/Mexico_City'
  });
  return {
    id: idDePendiente(c.id),
    title: tituloDelPendiente(c, dias),
    description: [
      `Sin movimiento desde el ${desde}. Etapa: ${ETIQUETA_ETAPA[c.etapa]}.`,
      c.vendedor ? `Vendedor: ${c.vendedor.name}.` : undefined,
      c.url
    ]
      .filter((x) => x)
      .join('\n'),
    status: 'pendiente',
    priority: c.etapa === 'negociacion' ? 'alta' : 'media',
    accountId: 'mios',
    origin: 'local',
    tags: ['cotizacion', c.etapa],
    url: c.url,
    updatedAt: ahora.toISOString()
  };
}

function normal(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * El vendedor de la cotizacion entre la gente del equipo: por correo y, si no
 * hay, por nombre completo (sin acentos ni mayusculas). Sin coincidencia
 * exacta no se adivina: la cotizacion se queda con el dueño.
 */
export function buscarVendedor(
  vendedor: Person | undefined,
  equipo: readonly Person[]
): Person | undefined {
  if (!vendedor) {
    return undefined;
  }
  const correo = vendedor.email?.trim().toLowerCase();
  if (correo) {
    const porCorreo = equipo.find(
      (p) => p.email?.trim().toLowerCase() === correo
    );
    if (porCorreo) {
      return porCorreo;
    }
  }
  const nombre = normal(vendedor.name ?? '');
  if (!nombre) {
    return undefined;
  }
  const coinciden = equipo.filter((p) => normal(p.name) === nombre);
  // Dos personas con el mismo nombre: no se sabe cual, mejor el dueño.
  return coinciden.length === 1 ? coinciden[0] : undefined;
}
