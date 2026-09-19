import type {
  ConfiguracionPrometheus,
  ConfiguracionServidores
} from '../config/entorno.js';
import type {
  VpsContainer,
  VpsHealth,
  VpsPoint,
  VpsStatus
} from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Lee Prometheus para armar el estado de cada servidor (VPS).
 *
 * Solo hace falta Prometheus con node_exporter (CPU, memoria, disco, red) y
 * cAdvisor (contenedores) en cada VPS: el puente le pregunta por su API
 * HTTP y el portal grafica. Grafana no interviene. Cada servidor se
 * identifica por la etiqueta de nombre (`nombre` por omision, puesta en
 * prometheus.yml) o, si no la hay, por el host de la instancia sin puerto.
 */

/** Umbrales para avisar. */
export const UMBRALES = {
  cpuAviso: 85,
  memAviso: 90,
  discoAviso: 85,
  discoCritico: 95,
  /** Sin muestra en este tiempo, el servidor esta "sin señal". */
  sinSenalMs: 5 * 60_000
};

const HORAS_HISTORIAL = 6;
const PASO_SEGUNDOS = 300;
const TIEMPO_LIMITE_MS = 15_000;

interface Muestra {
  metric: Record<string, string>;
  value: [number, string];
}

interface Serie {
  metric: Record<string, string>;
  values: [number, string][];
}

async function pedir<T>(
  config: ConfiguracionPrometheus,
  ruta: string,
  parametros: Record<string, string>
): Promise<T> {
  const url = new URL(`${config.url}/api/v1/${ruta}`);
  for (const [k, v] of Object.entries(parametros)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.token) {
    headers['authorization'] = `Bearer ${config.token}`;
  } else if (config.usuario) {
    headers['authorization'] =
      `Basic ${Buffer.from(`${config.usuario}:${config.contrasena ?? ''}`).toString('base64')}`;
  }
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
  try {
    const r = await fetch(url, { headers, signal: control.signal });
    if (r.status === 401 || r.status === 403) {
      throw new ErrorProveedor(
        'prometheus',
        'Prometheus rechazó las credenciales (usuario/contraseña o token).'
      );
    }
    if (!r.ok) {
      let detalle = '';
      try {
        const e = (await r.json()) as { error?: string };
        detalle = e.error ? `: ${e.error}` : '';
      } catch {
        // Sin cuerpo legible; con el estado alcanza.
      }
      throw new ErrorProveedor(
        'prometheus',
        `Prometheus respondió ${r.status}${detalle}`
      );
    }
    const cuerpo = (await r.json()) as {
      status: string;
      data?: { result?: T };
      error?: string;
    };
    if (cuerpo.status !== 'success') {
      throw new ErrorProveedor(
        'prometheus',
        cuerpo.error ?? 'Prometheus devolvió un error'
      );
    }
    return (cuerpo.data?.result ?? []) as T;
  } catch (error) {
    if (error instanceof ErrorProveedor) {
      throw error;
    }
    throw new ErrorProveedor(
      'prometheus',
      `No se pudo hablar con Prometheus en ${config.url}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(t);
  }
}

const consultar = (config: ConfiguracionPrometheus, expr: string) =>
  pedir<Muestra[]>(config, 'query', { query: expr });

const rango = (
  config: ConfiguracionPrometheus,
  expr: string,
  ahora: Date
): Promise<Serie[]> =>
  pedir<Serie[]>(config, 'query_range', {
    query: expr,
    start: String(Math.floor(ahora.getTime() / 1000 - HORAS_HISTORIAL * 3600)),
    end: String(Math.floor(ahora.getTime() / 1000)),
    step: String(PASO_SEGUNDOS)
  });

/** El host sin puerto: node_exporter va en :9100 y cAdvisor en :8080. */
function hostDe(instance: string): string {
  return instance.replace(/:\d+$/, '');
}

/** Con que se agrupa una muestra: la etiqueta de nombre o el host. */
function claveDe(m: Record<string, string>, etiqueta: string): string {
  return m[etiqueta] || hostDe(m['instance'] ?? '');
}

const numero = (v: string | undefined): number | undefined => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const redondea = (v: number | undefined, d = 1): number | undefined =>
  v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d;

// Consultas por servidor (node_exporter). Todas devuelven una muestra por
// instancia; la etiqueta de nombre viaja con las demas etiquetas.
const EXPRESIONES = {
  up: 'up{job="node"}',
  cpu: '100 * (1 - avg by (instance, {n}) (rate(node_cpu_seconds_total{mode="idle"}[5m])))',
  cores: 'count by (instance, {n}) (node_cpu_seconds_total{mode="idle"})',
  load1: 'node_load1',
  memPct:
    '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
  memTotal: 'node_memory_MemTotal_bytes',
  memAvail: 'node_memory_MemAvailable_bytes',
  diskPct:
    '100 * (1 - node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs"})',
  diskSize:
    'node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs"}',
  diskAvail:
    'node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay|squashfs"}',
  rx: 'sum by (instance, {n}) (rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*|virbr.*"}[5m]))',
  tx: 'sum by (instance, {n}) (rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*|virbr.*"}[5m]))',
  uptime: 'time() - node_boot_time_seconds',
  // cAdvisor
  contLast: 'container_last_seen{name!=""}',
  contCpu:
    '100 * sum by (instance, {n}, name) (rate(container_cpu_usage_seconds_total{name!=""}[5m]))',
  contMem: 'container_memory_working_set_bytes{name!=""}'
} as const;

function expr(clave: keyof typeof EXPRESIONES, etiqueta: string): string {
  return EXPRESIONES[clave].replaceAll('{n}', etiqueta);
}

/** Decide bien / aviso / critico por umbrales; sin señal si no reporta. */
export function saludDe(
  v: Pick<VpsStatus, 'online' | 'cpuPct' | 'memPct' | 'diskPct'>
): { health: VpsHealth; reason?: string } {
  if (!v.online) {
    return { health: 'sin_senal', reason: 'No reporta a Prometheus' };
  }
  const razones: string[] = [];
  let health: VpsHealth = 'bien';
  if (v.diskPct !== undefined && v.diskPct >= UMBRALES.discoCritico) {
    health = 'critico';
    razones.push(`disco al ${Math.round(v.diskPct)} %`);
  } else if (v.diskPct !== undefined && v.diskPct >= UMBRALES.discoAviso) {
    health = 'aviso';
    razones.push(`disco al ${Math.round(v.diskPct)} %`);
  }
  if (v.memPct !== undefined && v.memPct >= UMBRALES.memAviso) {
    health = health === 'critico' ? 'critico' : 'aviso';
    razones.push(`memoria al ${Math.round(v.memPct)} %`);
  }
  if (v.cpuPct !== undefined && v.cpuPct >= UMBRALES.cpuAviso) {
    health = health === 'critico' ? 'critico' : 'aviso';
    razones.push(`CPU al ${Math.round(v.cpuPct)} %`);
  }
  return { health, reason: razones.length ? razones.join(', ') : undefined };
}

/** Un nombre de etiqueta valido en PromQL; si no, se usa `nombre`. */
function etiquetaValida(etiqueta: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(etiqueta) ? etiqueta : 'nombre';
}

export async function estadoVps(
  config: ConfiguracionPrometheus,
  ahora = new Date()
): Promise<VpsStatus[]> {
  const n = etiquetaValida(config.etiquetaNombre);
  const q = (k: keyof typeof EXPRESIONES) => consultar(config, expr(k, n));
  const [
    up,
    cpu,
    cores,
    load1,
    memPct,
    memTotal,
    memAvail,
    diskPct,
    diskSize,
    diskAvail,
    rx,
    tx,
    uptime,
    contLast,
    contCpu,
    contMem,
    cpuSerie,
    memSerie
  ] = await Promise.all([
    q('up'),
    q('cpu'),
    q('cores'),
    q('load1'),
    q('memPct'),
    q('memTotal'),
    q('memAvail'),
    q('diskPct'),
    q('diskSize'),
    q('diskAvail'),
    q('rx'),
    q('tx'),
    q('uptime'),
    q('contLast').catch(() => [] as Muestra[]),
    q('contCpu').catch(() => [] as Muestra[]),
    q('contMem').catch(() => [] as Muestra[]),
    rango(config, expr('cpu', n), ahora).catch(() => [] as Serie[]),
    rango(config, expr('memPct', n), ahora).catch(() => [] as Serie[])
  ]);

  const porClave = (lista: Muestra[]): Map<string, Muestra> =>
    new Map(lista.map((m) => [claveDe(m.metric, n), m]));
  const valor = (mapa: Map<string, Muestra>, clave: string) =>
    numero(mapa.get(clave)?.value[1]);

  const mapas = {
    cpu: porClave(cpu),
    cores: porClave(cores),
    load1: porClave(load1),
    memPct: porClave(memPct),
    memTotal: porClave(memTotal),
    memAvail: porClave(memAvail),
    diskPct: porClave(diskPct),
    diskSize: porClave(diskSize),
    diskAvail: porClave(diskAvail),
    rx: porClave(rx),
    tx: porClave(tx),
    uptime: porClave(uptime)
  };

  const serieDe = (series: Serie[], clave: string): VpsPoint[] =>
    (series.find((s) => claveDe(s.metric, n) === clave)?.values ?? []).map(
      ([t, v]) => ({
        at: new Date(t * 1000).toISOString(),
        value: Math.round(Number(v) * 10) / 10
      })
    );

  // Contenedores por servidor (cAdvisor). "Corriendo" = visto hace poco.
  const contenedores = new Map<string, VpsContainer[]>();
  const cpuCont = new Map(
    contCpu.map((m) => [
      `${claveDe(m.metric, n)}|${m.metric['name']}`,
      numero(m.value[1])
    ])
  );
  const memCont = new Map(
    contMem.map((m) => [
      `${claveDe(m.metric, n)}|${m.metric['name']}`,
      numero(m.value[1])
    ])
  );
  for (const m of contLast) {
    const clave = claveDe(m.metric, n);
    const name = m.metric['name'] ?? '';
    const visto = Number(m.value[1]) * 1000;
    const lista = contenedores.get(clave) ?? [];
    lista.push({
      name,
      running: ahora.getTime() - visto < 2 * 60_000,
      cpuPct: redondea(cpuCont.get(`${clave}|${name}`)),
      memMb: redondea(
        (memCont.get(`${clave}|${name}`) ?? NaN) / (1024 * 1024),
        0
      ),
      lastSeen: new Date(visto).toISOString()
    });
    contenedores.set(clave, lista);
  }

  // Un servidor por instancia de node_exporter (aunque este caido: up=0).
  // El nombre que se ve (portal, carrusel, Telegram) es la etiqueta que se
  // capturo en Integraciones (lo que va antes de `|`); si ese Prometheus ve
  // varios servidores, se le agrega la etiqueta de prometheus.yml o el host.
  const salida: VpsStatus[] = [];
  const unico = up.length === 1;
  for (const m of up) {
    const clave = claveDe(m.metric, n);
    const online = m.value[1] === '1';
    const base = {
      online,
      cpuPct: redondea(valor(mapas.cpu, clave)),
      memPct: redondea(valor(mapas.memPct, clave)),
      diskPct: redondea(valor(mapas.diskPct, clave))
    };
    const { health, reason } = saludDe(base);
    const memTotalB = valor(mapas.memTotal, clave);
    const memAvailB = valor(mapas.memAvail, clave);
    const diskSizeB = valor(mapas.diskSize, clave);
    const diskAvailB = valor(mapas.diskAvail, clave);
    salida.push({
      id: config.nombre ? `${config.nombre}/${clave}` : clave,
      name: config.nombre
        ? unico
          ? config.nombre
          : `${config.nombre} · ${m.metric[n] || hostDe(m.metric['instance'] ?? clave)}`
        : m.metric[n] || hostDe(m.metric['instance'] ?? clave),
      health,
      reason,
      ...base,
      cores: valor(mapas.cores, clave),
      load1: redondea(valor(mapas.load1, clave), 2),
      memUsedMb:
        memTotalB !== undefined && memAvailB !== undefined
          ? Math.round((memTotalB - memAvailB) / (1024 * 1024))
          : undefined,
      memTotalMb:
        memTotalB !== undefined
          ? Math.round(memTotalB / (1024 * 1024))
          : undefined,
      diskUsedGb:
        diskSizeB !== undefined && diskAvailB !== undefined
          ? redondea((diskSizeB - diskAvailB) / 1024 ** 3)
          : undefined,
      diskTotalGb:
        diskSizeB !== undefined ? redondea(diskSizeB / 1024 ** 3) : undefined,
      netRxBps: redondea(valor(mapas.rx, clave), 0),
      netTxBps: redondea(valor(mapas.tx, clave), 0),
      uptimeSeconds: redondea(valor(mapas.uptime, clave), 0),
      lastSeen: new Date(Number(m.value[0]) * 1000).toISOString(),
      cpuHistory: serieDe(cpuSerie, clave),
      memHistory: serieDe(memSerie, clave),
      containers: (contenedores.get(clave) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
      accountId: config.accountId
    });
  }
  return salida.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Todos los servidores de todas las instancias de Prometheus configuradas.
 * Una instancia que no contesta no tira a las demas: sale como un servidor
 * "sin señal" con el motivo.
 */
export async function estadoServidores(
  config: ConfiguracionServidores,
  ahora = new Date()
): Promise<VpsStatus[]> {
  const resultados = await Promise.all(
    config.fuentes.map(async (fuente) => {
      try {
        return await estadoVps(fuente, ahora);
      } catch (error) {
        // Un Prometheus que no contesta se ve como un servidor sin señal con
        // el motivo, tambien cuando es el unico: asi la pantalla lo muestra
        // en vez de quedarse en blanco.
        const razon = error instanceof Error ? error.message : String(error);
        return [
          {
            id: fuente.nombre ?? fuente.url,
            name:
              fuente.nombre ?? hostDe(fuente.url.replace(/^https?:\/\//, '')),
            online: false,
            health: 'sin_senal' as const,
            reason: razon,
            cpuHistory: [],
            memHistory: [],
            containers: [],
            accountId: fuente.accountId
          }
        ];
      }
    })
  );
  return resultados.flat().sort((a, b) => a.name.localeCompare(b.name));
}
