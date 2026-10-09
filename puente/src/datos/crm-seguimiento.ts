import type {
  CrmActivity,
  CrmOpportunity,
  CrmStage
} from '../nucleo/contrato.js';

/**
 * Seguimiento de las oportunidades que llegan por /ingesta/crm (cotizaciones).
 *
 * Lo que manda el emisor es la verdad sobre la etapa, pero el puente recuerda
 * tres cosas que el emisor no sabe o no guarda:
 *
 * - Cuando cambio la etapa (el emisor solo manda "la etapa de hoy").
 * - Cuando llego por primera vez cada actividad ligada a una oportunidad: una
 *   actividad nueva cuenta como movimiento aunque la etapa siga igual.
 * - Los movimientos hechos a mano desde el tablero, que el emisor aun no
 *   confirma. Mientras no los confirme, el tablero muestra la etapa manual.
 *
 * Todo es puro: recibe el documento y devuelve otro. Quien llama lo guarda
 * (AlmacenJson, un documento `crm-seguimiento`, que sirve igual en archivos
 * que en Postgres).
 */

export const ETAPAS_CRM: CrmStage[] = [
  'nuevo',
  'calificado',
  'propuesta',
  'negociacion',
  'ganado',
  'perdido'
];

export interface MovimientoManual {
  etapa: CrmStage;
  /** Correo de la sesion (o "administración" con el token de administracion). */
  por: string;
  en: string;
  /** El emisor ya lo vio y lo aplico; desde aqui manda el emisor otra vez. */
  confirmado: boolean;
}

export interface SeguimientoOportunidad {
  /** Quien mando la oportunidad. Las rutas del emisor solo ven las suyas. */
  emisor: string;
  /** El id ya con prefijo del emisor, igual al que ve el portal. */
  id: string;
  /** La ultima etapa que MANDO el emisor (no la manual). */
  etapaVista: CrmStage;
  /** Cuando cambio la etapa por ultima vez (la del emisor o a mano). */
  cambioEn: string;
  manual?: MovimientoManual;
  /**
   * El movimiento (ultimoMovimiento) con el que se creo el pendiente de
   * vencimiento. Mientras no haya un movimiento posterior no se vuelve a
   * crear, aunque alguien lo haya marcado hecho o borrado a mano.
   */
  pendienteDesde?: string;
}

export interface ActividadVista {
  emisor: string;
  oportunidadId: string;
  vistaEn: string;
}

export interface SeguimientoCrm {
  oportunidades: Record<string, SeguimientoOportunidad>;
  actividades: Record<string, ActividadVista>;
}

export const SEGUIMIENTO_VACIO: SeguimientoCrm = {
  oportunidades: {},
  actividades: {}
};

/**
 * La llave lleva al emisor: dos emisores no pueden pisarse ni leerse el
 * seguimiento aunque sus ids, ya con prefijo, coincidieran por casualidad
 * ("a-b" + "c" contra "a" + "b-c").
 */
export function llave(emisor: string, id: string): string {
  return `${emisor}|${id}`;
}

/** El id como lo conoce el emisor: sin el prefijo con su nombre. */
export function idDelEmisor(emisor: string, id: string): string {
  const prefijo = `${emisor}-`;
  return id.startsWith(prefijo) ? id.slice(prefijo.length) : id;
}

/** El id con el prefijo del emisor, como lo arma normalizarCrm. */
export function idConPrefijo(emisor: string, idDelEmisor: string): string {
  return `${emisor}-${idDelEmisor}`;
}

export function esEtapa(valor: unknown): valor is CrmStage {
  return typeof valor === 'string' && ETAPAS_CRM.includes(valor as CrmStage);
}

/** Lo que llega en `generadoEn` no puede estar en el futuro: no vence nunca. */
function sinFuturo(iso: string, ahora: Date): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= ahora.getTime()
    ? new Date(t).toISOString()
    : ahora.toISOString();
}

function masReciente(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

export interface EnvioCrm {
  emisor: string;
  generadoEn: string;
  /** `undefined` = esa mitad del envio no se guardo (llego fuera de orden). */
  oportunidades?: Pick<CrmOpportunity, 'id' | 'stage'>[];
  actividades?: Pick<CrmActivity, 'id' | 'opportunityId'>[];
  modo: 'reemplazar' | 'agregar';
  ahora?: Date;
}

/**
 * Anota un envio: detecta cambios de etapa y actividades nuevas.
 *
 * - Oportunidad nueva: su cambio es el `generadoEn` del envio.
 * - Etapa distinta a la ultima vista: el cambio es el `generadoEn` (nunca
 *   anterior al que ya habia: un movimiento a mano posterior no se pierde).
 * - Con `reemplazar` lo que el emisor ya no manda se olvida; con `agregar`
 *   se conserva.
 */
export function registrarEnvio(
  previo: SeguimientoCrm,
  envio: EnvioCrm
): SeguimientoCrm {
  const ahora = envio.ahora ?? new Date();
  const cuando = sinFuturo(envio.generadoEn, ahora);
  const oportunidades = { ...previo.oportunidades };
  const actividades = { ...previo.actividades };

  if (envio.oportunidades) {
    const vistos = new Set<string>();
    for (const opp of envio.oportunidades) {
      const k = llave(envio.emisor, opp.id);
      vistos.add(k);
      const anterior = oportunidades[k];
      if (!anterior) {
        oportunidades[k] = {
          emisor: envio.emisor,
          id: opp.id,
          etapaVista: opp.stage,
          cambioEn: cuando
        };
      } else if (anterior.etapaVista !== opp.stage) {
        oportunidades[k] = {
          ...anterior,
          etapaVista: opp.stage,
          cambioEn: masReciente(anterior.cambioEn, cuando)
        };
      }
    }
    if (envio.modo === 'reemplazar') {
      for (const [k, entrada] of Object.entries(oportunidades)) {
        if (entrada.emisor === envio.emisor && !vistos.has(k)) {
          delete oportunidades[k];
        }
      }
    }
  }

  if (envio.actividades) {
    for (const act of envio.actividades) {
      if (!act.opportunityId) {
        continue;
      }
      const k = llave(envio.emisor, act.id);
      if (!actividades[k]) {
        actividades[k] = {
          emisor: envio.emisor,
          oportunidadId: act.opportunityId,
          vistaEn: cuando
        };
      }
    }
  }

  // Una actividad sin oportunidad seguida no sirve para nada: se va con ella.
  for (const [k, act] of Object.entries(actividades)) {
    if (!oportunidades[llave(act.emisor, act.oportunidadId)]) {
      delete actividades[k];
    }
  }

  return { oportunidades, actividades };
}

/**
 * Da de alta lo que ya estaba guardado antes de que existiera el seguimiento
 * (o que llego sin pasar por un envio): empieza a contar desde `cuando`.
 */
export function sembrar(
  previo: SeguimientoCrm,
  emisor: string,
  oportunidades: Pick<CrmOpportunity, 'id' | 'stage'>[],
  cuando: Date
): SeguimientoCrm {
  const faltan = oportunidades.filter(
    (o) => !previo.oportunidades[llave(emisor, o.id)]
  );
  if (faltan.length === 0) {
    return previo;
  }
  const nuevas = { ...previo.oportunidades };
  for (const opp of faltan) {
    nuevas[llave(emisor, opp.id)] = {
      emisor,
      id: opp.id,
      etapaVista: opp.stage,
      cambioEn: cuando.toISOString()
    };
  }
  return { ...previo, oportunidades: nuevas };
}

/** La etapa que se sirve: la manual mientras el emisor no la confirme. */
export function etapaServida(
  entrada: SeguimientoOportunidad | undefined,
  etapaDelEmisor: CrmStage
): CrmStage {
  return entrada?.manual && !entrada.manual.confirmado
    ? entrada.manual.etapa
    : etapaDelEmisor;
}

/** La actividad ligada mas nueva de cada oportunidad (por llave de oportunidad). */
export function indiceActividades(
  seguimiento: SeguimientoCrm
): Map<string, string> {
  const indice = new Map<string, string>();
  for (const act of Object.values(seguimiento.actividades)) {
    const k = llave(act.emisor, act.oportunidadId);
    const previa = indice.get(k);
    if (!previa || Date.parse(act.vistaEn) > Date.parse(previa)) {
      indice.set(k, act.vistaEn);
    }
  }
  return indice;
}

/**
 * Desde cuando esta quieta: el mayor entre el ultimo cambio de etapa (del
 * emisor o a mano) y la primera vez que llego una actividad ligada.
 */
export function ultimoMovimiento(
  entrada: SeguimientoOportunidad,
  actividades: Map<string, string>
): string {
  const actividad = actividades.get(llave(entrada.emisor, entrada.id));
  return actividad
    ? masReciente(entrada.cambioEn, actividad)
    : entrada.cambioEn;
}

export type ResultadoMover =
  | { ok: true; seguimiento: SeguimientoCrm; sinCambio: boolean }
  | { ok: false; motivo: 'no-existe' };

/**
 * Registra un movimiento hecho a mano desde el tablero. Cuenta como
 * movimiento (cambioEn). Pedir la etapa que ya se ve sin movimiento
 * pendiente no hace nada.
 */
export function moverManual(
  previo: SeguimientoCrm,
  datos: {
    emisor: string;
    id: string;
    etapa: CrmStage;
    por: string;
    etapaDelEmisor: CrmStage;
    ahora?: Date;
  }
): ResultadoMover {
  const k = llave(datos.emisor, datos.id);
  const entrada = previo.oportunidades[k];
  if (!entrada) {
    return { ok: false, motivo: 'no-existe' };
  }
  const pendiente = !!entrada.manual && !entrada.manual.confirmado;
  if (
    !pendiente &&
    etapaServida(entrada, datos.etapaDelEmisor) === datos.etapa
  ) {
    return { ok: true, seguimiento: previo, sinCambio: true };
  }
  const en = (datos.ahora ?? new Date()).toISOString();
  return {
    ok: true,
    sinCambio: false,
    seguimiento: {
      ...previo,
      oportunidades: {
        ...previo.oportunidades,
        [k]: {
          ...entrada,
          cambioEn: masReciente(entrada.cambioEn, en),
          manual: {
            etapa: datos.etapa,
            por: datos.por.slice(0, 120),
            en,
            confirmado: false
          }
        }
      }
    }
  };
}

export interface CambioParaEmisor {
  /** Sin prefijo: el id que el emisor mando. */
  id: string;
  etapa: CrmStage;
  por: string;
  en: string;
}

/** Los movimientos manuales sin confirmar de ESTE emisor, y de nadie mas. */
export function cambiosPendientes(
  seguimiento: SeguimientoCrm,
  emisor: string
): CambioParaEmisor[] {
  return Object.values(seguimiento.oportunidades)
    .filter((e) => e.emisor === emisor && e.manual && !e.manual.confirmado)
    .map((e) => ({
      id: idDelEmisor(emisor, e.id),
      etapa: (e.manual as MovimientoManual).etapa,
      por: (e.manual as MovimientoManual).por,
      en: (e.manual as MovimientoManual).en
    }))
    .sort((a, b) => a.en.localeCompare(b.en));
}

/** Lo que el emisor pide confirmar: el id solo, o el id con el `en` que vio. */
export type PedidoConfirmar = string | { id: string; en?: string };

/**
 * Marca como confirmados los movimientos del emisor. Un id que no es suyo (o
 * que no existe) se ignora sin decirlo. Con `{id, en}` solo se confirma si el
 * movimiento sigue siendo el que el emisor vio: si alguien lo movio otra vez
 * entre su lectura y su confirmacion, el nuevo queda pendiente.
 */
export function confirmar(
  previo: SeguimientoCrm,
  emisor: string,
  pedidos: PedidoConfirmar[]
): { seguimiento: SeguimientoCrm; confirmados: number } {
  const oportunidades = { ...previo.oportunidades };
  let confirmados = 0;
  for (const pedido of pedidos) {
    const id = typeof pedido === 'string' ? pedido : pedido.id;
    const visto = typeof pedido === 'string' ? undefined : pedido.en;
    const k = llave(emisor, idConPrefijo(emisor, id));
    const entrada = oportunidades[k];
    if (
      !entrada ||
      entrada.emisor !== emisor ||
      !entrada.manual ||
      entrada.manual.confirmado ||
      (visto !== undefined && entrada.manual.en !== visto)
    ) {
      continue;
    }
    oportunidades[k] = {
      ...entrada,
      manual: { ...entrada.manual, confirmado: true }
    };
    confirmados++;
  }
  return {
    seguimiento: confirmados > 0 ? { ...previo, oportunidades } : previo,
    confirmados
  };
}

/**
 * Pone encima de lo que mando el emisor lo que el puente sabe: la etapa
 * manual sin confirmar, desde cuando esta quieta y que se puede mover.
 */
export function aplicarSeguimiento(
  oportunidades: CrmOpportunity[],
  emisor: string,
  seguimiento: SeguimientoCrm
): CrmOpportunity[] {
  const actividades = indiceActividades(seguimiento);
  return oportunidades.map((opp) => {
    const entrada = seguimiento.oportunidades[llave(emisor, opp.id)];
    if (!entrada) {
      return { ...opp, ingested: true };
    }
    const pendiente =
      entrada.manual && !entrada.manual.confirmado ? entrada.manual : undefined;
    return {
      ...opp,
      ingested: true,
      stage: pendiente ? pendiente.etapa : opp.stage,
      stageChangedAt: entrada.cambioEn,
      lastMovementAt: ultimoMovimiento(entrada, actividades),
      stageManual: pendiente
        ? { by: pendiente.por, at: pendiente.en, reported: opp.stage }
        : undefined
    };
  });
}
