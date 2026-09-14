import {
  Deployment,
  DeploymentEnvironment,
  DeploymentState,
  PlatformStatus
} from '../../models';
import { DEMO_PEOPLE } from './demo-people';

/** Despliegues de demostración, con la forma que devuelve la API de Vercel. */
interface DespliegueSeed {
  id: string;
  project: string;
  url: string;
  state: DeploymentState;
  environment: DeploymentEnvironment;
  branch: string;
  commitSha: string;
  commitMessage: string;
  author: keyof typeof DEMO_PEOPLE;
  /** Minutos desde ahora hacia atrás en que arrancó. */
  minutosAtras: number;
  durationSeconds?: number;
}

const SEEDS: DespliegueSeed[] = [
  {
    id: 'dpl-1',
    project: 'portal-dealer',
    url: 'portal-dealer.vercel.app',
    state: 'construyendo',
    environment: 'produccion',
    branch: 'main',
    commitSha: '9f2c1ab',
    commitMessage: 'Agregar el modo carrusel para el monitor',
    author: 'ana',
    minutosAtras: 3
  },
  {
    id: 'dpl-2',
    project: 'sitio-itech',
    url: 'sitio-itech.vercel.app',
    state: 'error',
    environment: 'vista_previa',
    branch: 'rediseno-home',
    commitSha: '4c81de0',
    commitMessage: 'Rehacer el hero con el nuevo logo',
    author: 'carla',
    minutosAtras: 46,
    durationSeconds: 74
  },
  {
    id: 'dpl-3',
    project: 'portal-dealer',
    url: 'portal-dealer.vercel.app',
    state: 'listo',
    environment: 'produccion',
    branch: 'main',
    commitSha: '77a0b3e',
    commitMessage: 'Vestir el portal con la identidad de Dealer Solutions',
    author: 'yo',
    minutosAtras: 180,
    durationSeconds: 96
  },
  {
    id: 'dpl-4',
    project: 'facturacion',
    url: 'facturacion-pruebas.vercel.app',
    state: 'listo',
    environment: 'vista_previa',
    branch: 'timbrado-v2',
    commitSha: 'b31f7c5',
    commitMessage: 'Separar el timbrado del guardado de la factura',
    author: 'bruno',
    minutosAtras: 310,
    durationSeconds: 132
  },
  {
    id: 'dpl-5',
    project: 'tablero-leads',
    url: 'tablero-leads.vercel.app',
    state: 'cancelado',
    environment: 'vista_previa',
    branch: 'corte-diario',
    commitSha: 'e05a9d2',
    commitMessage: 'Mover el corte diario a la madrugada',
    author: 'elena',
    minutosAtras: 420,
    durationSeconds: 21
  },
  {
    id: 'dpl-6',
    project: 'sitio-itech',
    url: 'sitio-itech.vercel.app',
    state: 'listo',
    environment: 'produccion',
    branch: 'main',
    commitSha: '2ad4f18',
    commitMessage: 'Actualizar los datos de contacto del pie',
    author: 'carla',
    minutosAtras: 1_340,
    durationSeconds: 88
  }
];

export function demoDeployments(
  accountId: string,
  now = new Date()
): Deployment[] {
  return SEEDS.map((seed) => {
    const createdAt = new Date(now.getTime() - seed.minutosAtras * 60_000);
    return {
      id: seed.id,
      project: seed.project,
      url: `https://${seed.url}`,
      state: seed.state,
      environment: seed.environment,
      branch: seed.branch,
      commitSha: seed.commitSha,
      commitMessage: seed.commitMessage,
      author: DEMO_PEOPLE[seed.author],
      createdAt: createdAt.toISOString(),
      readyAt: seed.durationSeconds
        ? new Date(
            createdAt.getTime() + seed.durationSeconds * 1000
          ).toISOString()
        : undefined,
      durationSeconds: seed.durationSeconds,
      inspectorUrl: `https://vercel.com/dealer/${seed.project}/${seed.id}`,
      accountId
    };
  });
}

export function demoPlatformStatus(
  accountId: string,
  now = new Date()
): PlatformStatus[] {
  return [
    {
      id: 'vercel',
      label: 'Vercel',
      indicator: 'operativo',
      description: 'Todos los sistemas funcionando',
      url: 'https://www.vercel-status.com',
      checkedAt: now.toISOString(),
      accountId
    }
  ];
}
