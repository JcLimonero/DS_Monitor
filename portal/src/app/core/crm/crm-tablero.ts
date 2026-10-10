import {
  ALERTAS_ESTANCADOS_OMISION,
  CRM_ETAPA_COMERCIAL_LABEL,
  CRM_PROYECTO_ESTADO_LABEL,
  type CrmActividadCliente,
  type CrmAlertasEstancados,
  type CrmCotizacion,
  type CrmEtapaComercial,
  type CrmHito,
  type CrmProyecto,
  type CrmProyectoEstado,
  type CrmSemaforoProyecto
} from '../models/crm-nativo.model';

export const ETAPAS_KANBAN: CrmEtapaComercial[] = [
  'prospecto',
  'en_cotizacion',
  'cotizacion_enviada',
  'negociacion',
  'ganado',
  'perdido',
  'por_confirmar'
];

export const ESTADOS_EJECUCION: CrmProyectoEstado[] = [
  'en_desarrollo',
  'en_pruebas',
  'entregado',
  'en_soporte',
  'pausado'
];

export { ALERTAS_ESTANCADOS_OMISION };

/** Reexporta etiquetas para no importar el modelo en cada vista. */
export const ETAPA_LABEL = CRM_ETAPA_COMERCIAL_LABEL;
export const ESTADO_LABEL = CRM_PROYECTO_ESTADO_LABEL;

export function etapaEfectiva(
  proyecto: CrmProyecto
): CrmEtapaComercial | undefined {
  if (proyecto.etapaComercial) return proyecto.etapaComercial;
  switch (proyecto.estado) {
    case 'prospecto':
      return 'prospecto';
    case 'en_cotizacion':
      return 'en_cotizacion';
    case 'por_confirmar':
      return 'por_confirmar';
    case 'aprobado':
    case 'en_desarrollo':
    case 'en_pruebas':
    case 'entregado':
    case 'en_soporte':
    case 'pausado':
      return 'ganado';
    case 'cancelado':
      return 'perdido';
    default:
      return undefined;
  }
}

export function estadoEjecucion(
  proyecto: CrmProyecto
): CrmProyectoEstado | undefined {
  if (proyecto.estado && ESTADOS_EJECUCION.includes(proyecto.estado)) {
    return proyecto.estado;
  }
  if (etapaEfectiva(proyecto) === 'ganado') {
    return 'en_desarrollo';
  }
  return undefined;
}

export function diasEnEtapa(proyecto: CrmProyecto, ahora = new Date()): number {
  if (!proyecto.enEtapaComericalDesde) return 0;
  const desde = Date.parse(proyecto.enEtapaComericalDesde);
  if (Number.isNaN(desde)) return 0;
  return Math.floor((ahora.getTime() - desde) / 86_400_000);
}

export function proyectoEstancado(
  proyecto: CrmProyecto,
  alertas: CrmAlertasEstancados,
  ahora = new Date()
): boolean {
  const etapa = etapaEfectiva(proyecto);
  if (!etapa || etapa === 'ganado' || etapa === 'perdido') return false;
  const limite = alertas.diasPorEtapa[etapa] ?? alertas.diasDefault;
  return diasEnEtapa(proyecto, ahora) > limite;
}

export function calcularSemaforo(
  proyecto: CrmProyecto,
  hitos: CrmHito[],
  ahora = new Date()
): CrmSemaforoProyecto {
  if (proyecto.semaforo) return proyecto.semaforo;
  if (proyecto.estado === 'entregado' || proyecto.estado === 'en_soporte') {
    return 'en_tiempo';
  }
  const fin = proyecto.fechaFinEstimada
    ? Date.parse(proyecto.fechaFinEstimada)
    : NaN;
  const deEste = hitos.filter((h) => h.proyectoId === proyecto.id);
  const atrasados = deEste.filter(
    (h) =>
      !h.completado &&
      h.fechaCompromiso &&
      Date.parse(h.fechaCompromiso) < ahora.getTime()
  );
  if ((Number.isFinite(fin) && fin < ahora.getTime()) || atrasados.length > 0) {
    return 'atrasado';
  }
  const en7d = ahora.getTime() + 7 * 86_400_000;
  const cerca = deEste.filter(
    (h) =>
      !h.completado &&
      h.fechaCompromiso &&
      Date.parse(h.fechaCompromiso) <= en7d
  );
  if ((Number.isFinite(fin) && fin <= en7d) || cerca.length > 0) {
    return 'en_riesgo';
  }
  return 'en_tiempo';
}

export function montoVigenteDe(cotizaciones: CrmCotizacion[]): {
  total: number | null;
  moneda?: string;
  folio?: string;
} {
  const conMonto = cotizaciones.filter(
    (c) =>
      c.estatus !== 'rechazada' &&
      c.estatus !== 'obsoleta' &&
      c.estatus !== 'vencida'
  );
  const aprobadas = conMonto.filter((c) => c.estatus === 'aprobada');
  const enviadas = conMonto.filter((c) => c.estatus === 'enviada');
  const lista =
    aprobadas.length > 0
      ? aprobadas
      : enviadas.length > 0
        ? enviadas
        : conMonto;
  const mejor = [...lista].sort((a, b) => {
    const va = b.version ?? 0;
    const vb = a.version ?? 0;
    if (va !== vb) return va - vb;
    return (b.fechaEmision ?? '').localeCompare(a.fechaEmision ?? '');
  })[0];
  return {
    total: mejor?.total ?? null,
    moneda: mejor?.moneda,
    folio: mejor?.folio
  };
}

export function proximoPasoDe(
  actividades: CrmActividadCliente[],
  hitos: CrmHito[]
): string | undefined {
  const conPaso = [...actividades]
    .filter((a) => a.proximoPaso?.descripcion)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (conPaso?.proximoPaso?.descripcion) {
    return conPaso.proximoPaso.descripcion;
  }
  const hito = [...hitos]
    .filter((h) => !h.completado)
    .sort((a, b) =>
      (a.fechaCompromiso ?? '9999').localeCompare(b.fechaCompromiso ?? '9999')
    )[0];
  return hito?.nombre;
}

export interface FiltrosKanban {
  empresaId?: string;
  clienteId?: string;
  responsableId?: string;
}

export function filtrarProyectos(
  proyectos: CrmProyecto[],
  filtros: FiltrosKanban
): CrmProyecto[] {
  return proyectos.filter((p) => {
    if (filtros.empresaId && p.empresaAtiendeId !== filtros.empresaId) {
      return false;
    }
    if (
      filtros.clienteId &&
      p.clienteId !== filtros.clienteId &&
      p.clienteFinalId !== filtros.clienteId
    ) {
      return false;
    }
    if (filtros.responsableId === '__nadie__') {
      const hay =
        p.responsableInterno?.id ||
        p.responsableComercialId ||
        p.responsableInterno?.email;
      if (hay) return false;
    } else if (filtros.responsableId) {
      const id = filtros.responsableId;
      const coincide =
        p.responsableInterno?.id === id ||
        p.responsableComercialId === id ||
        p.responsableInterno?.email === id;
      if (!coincide) return false;
    }
    return true;
  });
}

export function agruparPorEtapa(
  proyectos: CrmProyecto[]
): Record<CrmEtapaComercial, CrmProyecto[]> {
  const grupos = Object.fromEntries(
    ETAPAS_KANBAN.map((e) => [e, [] as CrmProyecto[]])
  ) as Record<CrmEtapaComercial, CrmProyecto[]>;
  for (const p of proyectos) {
    const etapa = etapaEfectiva(p);
    if (!etapa) continue;
    grupos[etapa].push(p);
  }
  return grupos;
}

export function agruparPorEjecucion(
  proyectos: CrmProyecto[]
): Record<CrmProyectoEstado, CrmProyecto[]> {
  const grupos = Object.fromEntries(
    ESTADOS_EJECUCION.map((e) => [e, [] as CrmProyecto[]])
  ) as Record<CrmProyectoEstado, CrmProyecto[]>;
  for (const p of proyectos) {
    const estado = estadoEjecucion(p);
    if (!estado) continue;
    grupos[estado].push(p);
  }
  return grupos;
}

export function etapaVecina(
  actual: CrmEtapaComercial,
  direccion: -1 | 1
): CrmEtapaComercial | undefined {
  const i = ETAPAS_KANBAN.indexOf(actual);
  if (i < 0) return undefined;
  return ETAPAS_KANBAN[i + direccion];
}

export function estadoVecino(
  actual: CrmProyectoEstado,
  direccion: -1 | 1
): CrmProyectoEstado | undefined {
  const i = ESTADOS_EJECUCION.indexOf(actual);
  if (i < 0) return undefined;
  return ESTADOS_EJECUCION[i + direccion];
}
