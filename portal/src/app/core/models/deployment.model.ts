import { Person } from './common.model';

export type DeploymentState =
  'listo' | 'construyendo' | 'en_cola' | 'error' | 'cancelado';
export type DeploymentEnvironment = 'produccion' | 'vista_previa';

export const DEPLOYMENT_STATE_LABEL: Record<DeploymentState, string> = {
  listo: 'Listo',
  construyendo: 'Construyendo',
  en_cola: 'En cola',
  error: 'Error',
  cancelado: 'Cancelado'
};

export const DEPLOYMENT_ENVIRONMENT_LABEL: Record<
  DeploymentEnvironment,
  string
> = {
  produccion: 'Producción',
  vista_previa: 'Vista previa'
};

export interface Deployment {
  id: string;
  /** Proyecto al que pertenece el despliegue. */
  project: string;
  url: string;
  state: DeploymentState;
  environment: DeploymentEnvironment;
  branch?: string;
  /** Hash corto del commit, como se muestra en la interfaz. */
  commitSha?: string;
  commitMessage?: string;
  author?: Person;
  createdAt: string;
  readyAt?: string;
  /** Cuanto tardó la construcción, en segundos. */
  durationSeconds?: number;
  /** Liga al detalle en el panel del proveedor. */
  inspectorUrl?: string;
  accountId: string;
}

/**
 * Estado del proveedor mismo, no del despliegue.
 *
 * Sirve para no perder media hora revisando una construcción que falló porque
 * la plataforma esta caída y no por el código.
 */
export type PlatformIndicator =
  'operativo' | 'menor' | 'mayor' | 'critico' | 'mantenimiento' | 'desconocido';

export const PLATFORM_INDICATOR_LABEL: Record<PlatformIndicator, string> = {
  operativo: 'Operativo',
  menor: 'Incidente menor',
  mayor: 'Incidente mayor',
  critico: 'Incidente crítico',
  mantenimiento: 'Mantenimiento',
  desconocido: 'Sin datos'
};

export interface PlatformStatus {
  id: string;
  label: string;
  indicator: PlatformIndicator;
  description: string;
  url?: string;
  checkedAt: string;
  accountId: string;
}

export function deploymentFailed(deployment: Deployment): boolean {
  return deployment.state === 'error';
}

export function deploymentRunning(deployment: Deployment): boolean {
  return deployment.state === 'construyendo' || deployment.state === 'en_cola';
}
