import type { ConfiguracionCoolify } from '../config/entorno.js';
import type { HostedApp, HostedAppStatus } from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Lee de Coolify (API v1, token bearer) los portales montados: aplicaciones
 * (de git o imagen) y servicios (docker compose), con su estado, dominio,
 * servidor, proyecto y ultimo despliegue.
 *
 * La API cambia entre versiones de Coolify, asi que todo se lee a la
 * defensiva: lo que no venga se deja vacio en vez de fallar.
 */

const TIEMPO_LIMITE_MS = 15_000;

type Crudo = Record<string, unknown>;

async function pedir<T>(
  config: ConfiguracionCoolify,
  ruta: string
): Promise<T> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
  try {
    const r = await fetch(`${config.url}/api/v1${ruta}`, {
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/json'
      },
      signal: control.signal
    });
    if (r.status === 401 || r.status === 403) {
      throw new ErrorProveedor(
        'coolify',
        'Coolify rechazó el token (Keys & Tokens → API tokens).'
      );
    }
    if (r.status === 404) {
      return [] as T;
    }
    if (!r.ok) {
      throw new ErrorProveedor('coolify', `Coolify respondió ${r.status}`);
    }
    return (await r.json()) as T;
  } catch (error) {
    if (error instanceof ErrorProveedor) {
      throw error;
    }
    throw new ErrorProveedor(
      'coolify',
      `No se pudo hablar con Coolify en ${config.url}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(t);
  }
}

const texto = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const objeto = (v: unknown): Crudo | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Crudo) : undefined;

/** "running:healthy" → running; "exited:unhealthy" → stopped; etc. */
export function estadoDe(raw: string | undefined): {
  status: HostedAppStatus;
  healthy?: boolean;
} {
  if (!raw) {
    return { status: 'unknown' };
  }
  const [estado, salud] = raw.toLowerCase().split(':');
  const healthy =
    salud === 'healthy' ? true : salud === 'unhealthy' ? false : undefined;
  if (estado === 'running') {
    return { status: 'running', healthy };
  }
  if (estado === 'exited' || estado === 'stopped' || estado === 'paused') {
    return { status: 'stopped', healthy };
  }
  if (estado === 'degraded' || estado === 'error' || estado === 'restarting') {
    return { status: 'error', healthy };
  }
  return { status: 'unknown', healthy };
}

/** El primer dominio de `fqdn` ("https://a.com,https://b.com"). */
function urlDe(fqdn: unknown): string | undefined {
  const primero = texto(fqdn)?.split(',')[0]?.trim();
  return primero ? primero : undefined;
}

function repoDe(crudo: Crudo): string | undefined {
  const repo = texto(crudo['git_repository']);
  return repo?.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
}

export async function portalesCoolify(
  config: ConfiguracionCoolify
): Promise<HostedApp[]> {
  const [apps, servicios, servidores, proyectos] = await Promise.all([
    pedir<Crudo[]>(config, '/applications').catch(() => [] as Crudo[]),
    pedir<Crudo[]>(config, '/services').catch(() => [] as Crudo[]),
    pedir<Crudo[]>(config, '/servers').catch(() => [] as Crudo[]),
    pedir<Crudo[]>(config, '/projects').catch(() => [] as Crudo[])
  ]);
  const nombreServidor = new Map<string, string>();
  for (const s of Array.isArray(servidores) ? servidores : []) {
    const nombre = texto(s['name']) ?? texto(s['ip']);
    for (const clave of [s['id'], s['uuid']]) {
      if (clave !== undefined && nombre) {
        nombreServidor.set(String(clave), nombre);
      }
    }
  }
  const nombreProyecto = new Map<string, string>();
  for (const p of Array.isArray(proyectos) ? proyectos : []) {
    const nombre = texto(p['name']);
    for (const clave of [p['id'], p['uuid']]) {
      if (clave !== undefined && nombre) {
        nombreProyecto.set(String(clave), nombre);
      }
    }
  }
  const servidorDe = (crudo: Crudo): string | undefined => {
    const destino = objeto(crudo['destination']);
    const servidor = objeto(destino?.['server']) ?? objeto(crudo['server']);
    return (
      texto(servidor?.['name']) ??
      texto(servidor?.['ip']) ??
      (destino?.['server_id'] !== undefined
        ? nombreServidor.get(String(destino['server_id']))
        : undefined) ??
      (crudo['server_id'] !== undefined
        ? nombreServidor.get(String(crudo['server_id']))
        : undefined)
    );
  };
  const proyectoDe = (crudo: Crudo): string | undefined => {
    const entorno = objeto(crudo['environment']);
    const proyecto = objeto(entorno?.['project']) ?? objeto(crudo['project']);
    return (
      texto(proyecto?.['name']) ??
      (entorno?.['project_id'] !== undefined
        ? nombreProyecto.get(String(entorno['project_id']))
        : undefined)
    );
  };
  const entornoDe = (crudo: Crudo): string | undefined =>
    texto(objeto(crudo['environment'])?.['name']);

  const salida: HostedApp[] = [];
  for (const a of Array.isArray(apps) ? apps : []) {
    const raw = texto(a['status']);
    salida.push({
      id: `app-${texto(a['uuid']) ?? String(a['id'])}`,
      name: texto(a['name']) ?? 'Aplicación',
      kind: 'app',
      ...estadoDe(raw),
      rawStatus: raw,
      url: urlDe(a['fqdn']),
      server: servidorDe(a),
      project: proyectoDe(a),
      environment: entornoDe(a),
      repo: repoDe(a),
      branch: texto(a['git_branch']),
      lastDeployAt: texto(a['last_online_at']),
      updatedAt: texto(a['updated_at']),
      accountId: config.accountId
    });
  }
  for (const s of Array.isArray(servicios) ? servicios : []) {
    const raw = texto(s['status']);
    salida.push({
      id: `svc-${texto(s['uuid']) ?? String(s['id'])}`,
      name: texto(s['name']) ?? 'Servicio',
      kind: 'service',
      ...estadoDe(raw),
      rawStatus: raw,
      url: urlDe(s['fqdn']),
      server: servidorDe(s),
      project: proyectoDe(s),
      environment: entornoDe(s),
      updatedAt: texto(s['updated_at']),
      accountId: config.accountId
    });
  }

  // El ultimo despliegue de cada aplicacion, si la API lo da. Se pide en
  // paralelo y lo que falle se deja sin fecha.
  await Promise.all(
    salida
      .filter((p) => p.kind === 'app')
      .map(async (p) => {
        const uuid = p.id.slice(4);
        try {
          const lista = await pedir<Crudo[] | { data?: Crudo[] }>(
            config,
            `/deployments/applications/${uuid}?take=1`
          );
          const filas = Array.isArray(lista) ? lista : (lista?.data ?? []);
          const ultimo = filas[0];
          if (ultimo) {
            p.lastDeployAt =
              texto(ultimo['finished_at']) ??
              texto(ultimo['updated_at']) ??
              texto(ultimo['created_at']) ??
              p.lastDeployAt;
            p.lastDeployStatus = texto(ultimo['status']);
          }
        } catch {
          // Sin historial de despliegues en esta version de Coolify.
        }
      })
  );

  const peso: Record<HostedAppStatus, number> = {
    error: 0,
    stopped: 1,
    unknown: 2,
    running: 3
  };
  return salida.sort(
    (a, b) =>
      peso[a.status] - peso[b.status] ||
      (a.server ?? '').localeCompare(b.server ?? '') ||
      a.name.localeCompare(b.name)
  );
}
