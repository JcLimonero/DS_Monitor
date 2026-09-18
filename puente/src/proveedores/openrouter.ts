import type { ConfiguracionIa } from '../config/entorno.js';
import type { LicenseUsage } from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * El consumo de la llave de OpenRouter como una suscripcion mas: cuanto va
 * del mes, contra el limite de la llave (o los creditos cargados), en USD.
 * Sale de /auth/key (uso diario, semanal y mensual de la llave) y de
 * /credits (creditos totales de la cuenta).
 */
interface Llave {
  data?: {
    label?: string;
    limit?: number | null;
    limit_remaining?: number | null;
    usage?: number;
    usage_daily?: number;
    usage_weekly?: number;
    usage_monthly?: number;
    is_free_tier?: boolean;
  };
}

interface Creditos {
  data?: { total_credits?: number; total_usage?: number };
}

export async function consumoOpenRouter(
  config: ConfiguracionIa,
  ahora = new Date()
): Promise<LicenseUsage[]> {
  const encabezados = { authorization: `Bearer ${config.apiKey}` };
  const [rLlave, rCreditos] = await Promise.all([
    fetch('https://openrouter.ai/api/v1/auth/key', { headers: encabezados }),
    fetch('https://openrouter.ai/api/v1/credits', { headers: encabezados })
  ]);
  if (!rLlave.ok) {
    throw new ErrorProveedor(
      'openrouter',
      `no pudo leer la llave (${rLlave.status})`,
      rLlave.status === 401 ? 503 : 502
    );
  }
  const llave = ((await rLlave.json()) as Llave).data ?? {};
  const creditos = rCreditos.ok
    ? (((await rCreditos.json()) as Creditos).data ?? {})
    : {};
  const inicioMes = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)
  );
  const finMes = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() + 1, 0, 23, 59, 59)
  );
  const mensual = Number(llave.usage_monthly ?? llave.usage ?? 0);
  const saldo =
    creditos.total_credits !== undefined && creditos.total_usage !== undefined
      ? creditos.total_credits - creditos.total_usage
      : undefined;
  const tope =
    typeof llave.limit === 'number' && llave.limit > 0
      ? llave.limit
      : creditos.total_credits;
  return [
    {
      id: 'openrouter-consumo',
      provider: 'otro',
      product: 'OpenRouter (IA)',
      plan: [
        `modelo ${config.modelo}`,
        saldo !== undefined ? `saldo ${saldo.toFixed(2)} USD` : undefined,
        llave.usage_daily !== undefined
          ? `hoy ${Number(llave.usage_daily).toFixed(3)} USD`
          : undefined
      ]
        .filter((x) => x)
        .join(' · '),
      unit: 'dinero',
      used: Math.round(mensual * 100) / 100,
      limit: tope !== undefined ? Math.round(tope * 100) / 100 : undefined,
      periodStart: inicioMes.toISOString(),
      periodEnd: finMes.toISOString(),
      cost: Math.round(mensual * 100) / 100,
      currency: 'USD',
      manual: false,
      members: [],
      accountId: 'openrouter',
      url: 'https://openrouter.ai/activity',
      updatedAt: ahora.toISOString()
    }
  ];
}
