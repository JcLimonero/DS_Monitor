export type MonitorKind = 'sitio' | 'api' | 'servicio' | 'proceso';
export type MonitorStatus =
  'operativo' | 'degradado' | 'caido' | 'mantenimiento' | 'desconocido';
export type MonitorEnvironment = 'produccion' | 'pruebas' | 'desarrollo';

/** Una revisión puntual del destino: el resultado de un solo ping. */
export interface MonitorCheck {
  at: string;
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
}

export interface MonitorTarget {
  id: string;
  name: string;
  kind: MonitorKind;
  /** URL publica del sitio o del endpoint de salud. */
  url: string;
  environment: MonitorEnvironment;
  status: MonitorStatus;
  /** Latencia de la última revisión, en milisegundos. */
  latencyMs?: number;
  /** Porcentaje de revisiones exitosas, de 0 a 100. */
  uptime24h: number;
  uptime30d: number;
  lastCheck?: string;
  /** Historial reciente, de más viejo a más nuevo. Alimenta la gráfica. */
  history: MonitorCheck[];
  /** Descripción del incidente en curso, si el destino no está operativo. */
  incident?: string;
  accountId: string;
}

export const MONITOR_STATUS_LABEL: Record<MonitorStatus, string> = {
  operativo: 'Operativo',
  degradado: 'Degradado',
  caido: 'Caído',
  mantenimiento: 'Mantenimiento',
  desconocido: 'Sin datos'
};

export const MONITOR_ENVIRONMENT_LABEL: Record<MonitorEnvironment, string> = {
  produccion: 'Producción',
  pruebas: 'Pruebas',
  desarrollo: 'Desarrollo'
};

export const MONITOR_KIND_LABEL: Record<MonitorKind, string> = {
  sitio: 'Sitio web',
  api: 'API',
  servicio: 'Servicio',
  proceso: 'Proceso'
};

/** Los dos estados que exigen atención inmediata en el panel. */
export function needsAttention(target: MonitorTarget): boolean {
  return target.status === 'caido' || target.status === 'degradado';
}
