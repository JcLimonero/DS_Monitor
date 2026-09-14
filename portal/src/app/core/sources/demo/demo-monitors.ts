import {
  MonitorCheck,
  MonitorEnvironment,
  MonitorKind,
  MonitorStatus,
  MonitorTarget
} from '../../models';
import { MS_HOUR } from '../../util/date.util';
import { randomInt, seededRandom } from './demo-random';

/** Cuántas revisiones guarda el historial que dibuja la gráfica. */
const HISTORY_POINTS = 48;

interface TargetSeed {
  id: string;
  name: string;
  kind: MonitorKind;
  url: string;
  environment: MonitorEnvironment;
  status: MonitorStatus;
  /** Latencia tipica en milisegundos; el historial oscila alrededor de ella. */
  baseLatency: number;
  incident?: string;
}

// Dominios .example: reservados para documentación, no apuntan a nada real.
const TARGET_SEEDS: TargetSeed[] = [
  {
    id: 'track-portal',
    name: 'Portal VGD SF Track',
    kind: 'sitio',
    url: 'https://track.example.mx',
    environment: 'produccion',
    status: 'operativo',
    baseLatency: 180
  },
  {
    id: 'api-vanguardia',
    name: 'API Vanguardia',
    kind: 'api',
    url: 'https://api.example.mx/health',
    environment: 'produccion',
    status: 'degradado',
    baseLatency: 920,
    incident:
      'La latencia lleva 40 minutos arriba de un segundo en /customer/order.'
  },
  {
    id: 'sitio-itech',
    name: 'Sitio corporativo Itech',
    kind: 'sitio',
    url: 'https://itech.example.com',
    environment: 'produccion',
    status: 'operativo',
    baseLatency: 240
  },
  {
    id: 'odoo-itech',
    name: 'Odoo CRM Itech',
    kind: 'servicio',
    url: 'https://crm.example.com/web/health',
    environment: 'produccion',
    status: 'operativo',
    baseLatency: 310
  },
  {
    id: 'envio-sf',
    name: 'Envío nocturno a Salesforce',
    kind: 'proceso',
    url: 'https://api.example.mx/jobs/envio-sf',
    environment: 'produccion',
    status: 'caido',
    baseLatency: 0,
    incident:
      'La corrida de las 02:00 abortó por token vencido. 312 registros en cola.'
  },
  {
    id: 'api-inventario',
    name: 'API de inventario',
    kind: 'api',
    url: 'https://api.example.mx/vgd/inventory',
    environment: 'produccion',
    status: 'operativo',
    baseLatency: 420
  },
  {
    id: 'portal-facturación',
    name: 'Portal de facturación',
    kind: 'sitio',
    url: 'https://facturacion.pruebas.example.mx',
    environment: 'pruebas',
    status: 'mantenimiento',
    baseLatency: 260,
    incident: 'Ventana de mantenimiento programada hasta las 20:00.'
  },
  {
    id: 'tablero-ops',
    name: 'Tablero Ops',
    kind: 'sitio',
    url: 'https://ops.dev.example.mx',
    environment: 'desarrollo',
    status: 'operativo',
    baseLatency: 150
  }
];

/**
 * Arma el historial reciente de un destino.
 *
 * Las revisiones se separan media hora entre sí, así que las 48 del historial
 * cubren un día. Solo falla lo que de verdad está fallando: un destino sano no
 * mete fallas al azar, porque cada una le baja dos puntos a la disponibilidad
 * del día y la tarjeta acabaría diciendo "operativo, 91%", que no cuadra.
 */
function buildHistory(seed: TargetSeed, now: Date): MonitorCheck[] {
  const next = seededRandom(seed.id);
  const checks: MonitorCheck[] = [];
  for (let i = HISTORY_POINTS - 1; i >= 0; i--) {
    const at = new Date(now.getTime() - i * (MS_HOUR / 2));
    // La ventana reciente es la que refleja el estado actual del destino.
    const recent = i < 4;
    let ok = true;
    let latency = seed.baseLatency + randomInt(next, -60, 90);

    if (
      recent &&
      (seed.status === 'caido' || seed.status === 'mantenimiento')
    ) {
      ok = false;
      latency = 0;
    } else if (seed.status === 'degradado' && recent) {
      // Degradado responde, nada más que tarde: la falla sería otra cosa.
      latency = seed.baseLatency + randomInt(next, 300, 900);
    }

    checks.push({
      at: at.toISOString(),
      ok,
      latencyMs: Math.max(0, latency),
      statusCode: ok ? 200 : seed.status === 'mantenimiento' ? 503 : 500
    });
  }
  return checks;
}

function uptimeOf(checks: MonitorCheck[]): number {
  if (checks.length === 0) {
    return 0;
  }
  const ok = checks.filter((check) => check.ok).length;
  return Math.round((ok / checks.length) * 1000) / 10;
}

export function demoMonitorTargets(
  accountId: string,
  now = new Date()
): MonitorTarget[] {
  return TARGET_SEEDS.map((seed) => {
    const history = buildHistory(seed, now);
    const last = history[history.length - 1];
    const next = seededRandom(`${seed.id}-30d`);
    return {
      id: seed.id,
      name: seed.name,
      kind: seed.kind,
      url: seed.url,
      environment: seed.environment,
      status: seed.status,
      latencyMs: last.ok ? last.latencyMs : undefined,
      uptime24h: uptimeOf(history),
      // A 30 días solo guardamos el resumen, no las 1440 revisiones.
      uptime30d: Math.round((99.9 - next() * 1.6) * 10) / 10,
      lastCheck: last.at,
      history,
      incident: seed.incident,
      accountId
    };
  });
}
