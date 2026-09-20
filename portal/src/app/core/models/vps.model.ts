/**
 * Un servidor (VPS) tal como lo sirve el puente leyendo Prometheus
 * (node_exporter y cAdvisor). Mismo contrato que en puente/src/nucleo/contrato.ts.
 */
// --- Servidores (VPS) con Prometheus ---

export type VpsHealth = 'bien' | 'aviso' | 'critico' | 'sin_senal';

export interface VpsPoint {
  at: string;
  value: number;
}

export interface VpsContainer {
  name: string;
  running: boolean;
  cpuPct?: number;
  memMb?: number;
  lastSeen: string;
}

export interface VpsStatus {
  /** El host (instancia sin puerto) o la etiqueta de nombre. */
  id: string;
  name: string;
  online: boolean;
  health: VpsHealth;
  /** Que disparo el aviso o el critico, en palabras. */
  reason?: string;
  cpuPct?: number;
  cores?: number;
  load1?: number;
  memPct?: number;
  memUsedMb?: number;
  memTotalMb?: number;
  diskPct?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  netRxBps?: number;
  netTxBps?: number;
  uptimeSeconds?: number;
  lastSeen?: string;
  /** Ultimas horas, para la grafica. */
  cpuHistory: VpsPoint[];
  memHistory: VpsPoint[];
  containers: VpsContainer[];
  accountId: string;
}

// --- Portales montados en Coolify ---

export type HostedAppStatus = 'running' | 'stopped' | 'error' | 'unknown';

/** Una aplicacion o servicio montado en Coolify. */
export interface HostedApp {
  id: string;
  name: string;
  kind: 'app' | 'service';
  status: HostedAppStatus;
  /** Lo que dice Coolify tal cual, por ejemplo "running:healthy". */
  rawStatus?: string;
  /** Sano segun el healthcheck, si Coolify lo reporta. */
  healthy?: boolean;
  url?: string;
  server?: string;
  project?: string;
  environment?: string;
  repo?: string;
  branch?: string;
  lastDeployAt?: string;
  lastDeployStatus?: string;
  updatedAt?: string;
  accountId: string;
}
