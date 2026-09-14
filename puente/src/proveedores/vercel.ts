import type { ConfiguracionVercel } from '../config/entorno.js';
import type {
  Deployment,
  DeploymentState,
  LicenseUsage,
  PlatformIndicator,
  PlatformStatus
} from '../nucleo/contrato.js';
import { conParametros, pedirJson } from '../nucleo/http.js';
import { periodoDelMes } from './anthropic.js';

/**
 * Despliegues de Vercel y estado de la plataforma.
 *
 *   GET /v6/deployments   -> despliegues del usuario o del equipo
 *
 * Se autentica con `Authorization: Bearer`. Para un equipo hay que pasar
 * ademas `teamId`, que sale de la configuracion general del equipo en el panel.
 *
 * El estado de la plataforma no viene de la API sino de la pagina publica de
 * estado, en formato Statuspage. Vale la pena tenerlo: separa "fallo mi
 * construccion" de "Vercel esta caido", que son dos problemas muy distintos y
 * se ven igual desde el portal.
 */

const BASE = 'https://api.vercel.com';

interface DespliegueVercel {
  uid?: string;
  id?: string;
  name?: string;
  url?: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  created?: number;
  createdAt?: number;
  ready?: number;
  buildingAt?: number;
  inspectorUrl?: string;
  creator?: { uid?: string; username?: string; email?: string };
  meta?: Record<string, string | undefined>;
}

interface RespuestaDespliegues {
  deployments?: DespliegueVercel[];
}

interface RespuestaEstado {
  status?: { indicator?: string; description?: string };
  page?: { name?: string; url?: string };
}

/** Traduce el estado de Vercel al del portal. */
export function estadoDespliegue(crudo: string | undefined): DeploymentState {
  switch ((crudo ?? '').toUpperCase()) {
    case 'READY':
      return 'listo';
    case 'BUILDING':
    case 'INITIALIZING':
      return 'construyendo';
    case 'QUEUED':
      return 'en_cola';
    case 'ERROR':
      return 'error';
    case 'CANCELED':
      return 'cancelado';
    default:
      // Un estado que no conocemos no es un exito: se trata como en cola para
      // que no aparezca en verde sin haber terminado.
      return 'en_cola';
  }
}

/** El indicador de Statuspage traducido al del portal. */
export function indicadorPlataforma(
  crudo: string | undefined
): PlatformIndicator {
  switch ((crudo ?? '').toLowerCase()) {
    case 'none':
      return 'operativo';
    case 'minor':
      return 'menor';
    case 'major':
      return 'mayor';
    case 'critical':
      return 'critico';
    case 'maintenance':
      return 'mantenimiento';
    default:
      return 'desconocido';
  }
}

/**
 * Traduce un despliegue de Vercel al modelo del portal.
 *
 * Los datos de git viajan en `meta` con nombres distintos segun el proveedor
 * (`githubCommitRef`, `gitlabCommitRef`...), asi que se busca el primero que
 * venga en lugar de asumir GitHub.
 */
export function aDespliegue(
  crudo: DespliegueVercel,
  accountId: string,
  ahora = new Date()
): Deployment {
  const meta = crudo.meta ?? {};
  const primero = (...claves: string[]): string | undefined => {
    for (const clave of claves) {
      const valor = meta[clave];
      if (valor) {
        return valor;
      }
    }
    return undefined;
  };

  const creado = crudo.created ?? crudo.createdAt ?? ahora.getTime();
  const listo = crudo.ready;
  const inicio = crudo.buildingAt ?? creado;

  return {
    id: crudo.uid ?? crudo.id ?? String(creado),
    project: crudo.name ?? 'sin nombre',
    url: crudo.url ? `https://${crudo.url}` : '',
    state: estadoDespliegue(crudo.readyState ?? crudo.state),
    environment: crudo.target === 'production' ? 'produccion' : 'vista_previa',
    branch: primero(
      'githubCommitRef',
      'gitlabCommitRef',
      'bitbucketCommitRef',
      'branch'
    ),
    commitSha: primero(
      'githubCommitSha',
      'gitlabCommitSha',
      'bitbucketCommitSha',
      'commitSha'
    )?.slice(0, 7),
    commitMessage: primero(
      'githubCommitMessage',
      'gitlabCommitMessage',
      'bitbucketCommitMessage',
      'commitMessage'
    ),
    author: crudo.creator?.username
      ? {
          id: crudo.creator.uid ?? crudo.creator.username,
          name: crudo.creator.username,
          email: crudo.creator.email
        }
      : undefined,
    createdAt: new Date(creado).toISOString(),
    readyAt: listo ? new Date(listo).toISOString() : undefined,
    durationSeconds: listo
      ? Math.max(0, Math.round((listo - inicio) / 1000))
      : undefined,
    inspectorUrl: crudo.inspectorUrl,
    accountId
  };
}

export async function desplieguesVercel(
  config: ConfiguracionVercel,
  ahora = new Date()
): Promise<Deployment[]> {
  const respuesta = await pedirJson<RespuestaDespliegues>(
    'Vercel',
    conParametros(`${BASE}/v6/deployments`, {
      limit: String(config.limite),
      teamId: config.teamId
    }),
    { encabezados: { authorization: `Bearer ${config.token}` } }
  );

  return (respuesta.deployments ?? []).map((crudo) =>
    aDespliegue(crudo, config.accountId, ahora)
  );
}

export async function estadoPlataformaVercel(
  config: ConfiguracionVercel,
  ahora = new Date()
): Promise<PlatformStatus[]> {
  const respuesta = await pedirJson<RespuestaEstado>(
    'Vercel',
    config.urlEstado,
    {
      // La pagina de estado es publica: no lleva credencial.
      reintentos: 0
    }
  );

  return [
    {
      id: 'vercel',
      label: respuesta.page?.name ?? 'Vercel',
      indicator: indicadorPlataforma(respuesta.status?.indicator),
      description: respuesta.status?.description ?? 'Sin descripción',
      url: respuesta.page?.url ?? 'https://www.vercel-status.com',
      checkedAt: ahora.toISOString(),
      accountId: config.accountId
    }
  ];
}

/**
 * Consumo de la plataforma.
 *
 * Vercel no expone el gasto del periodo en una API publica y estable, asi que
 * esta licencia se arma con lo que se capture en el entorno. Si no hay nada
 * capturado, no se inventa una tarjeta vacia: se devuelve una lista vacia.
 */
export function licenciasVercel(
  config: ConfiguracionVercel,
  ahora = new Date()
): LicenseUsage[] {
  if (
    config.gastoMensual === undefined &&
    config.presupuestoMensual === undefined
  ) {
    return [];
  }

  const { inicio, fin } = periodoDelMes(ahora);
  return [
    {
      id: 'vercel-plan',
      provider: 'vercel',
      product: 'Vercel',
      plan: 'Equipo',
      unit: 'dinero',
      used: config.gastoMensual ?? 0,
      limit: config.presupuestoMensual,
      periodStart: inicio,
      periodEnd: fin,
      cost: config.gastoMensual,
      currency: 'USD',
      renewsAt: config.renuevaEn,
      manual: true,
      members: [],
      accountId: config.accountId,
      url: 'https://vercel.com/dashboard/usage',
      updatedAt: ahora.toISOString()
    }
  ];
}
