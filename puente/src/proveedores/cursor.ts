import type { ConfiguracionCursor } from '../config/entorno.js';
import type {
  LicenseMember,
  LicenseUsage,
  Person
} from '../nucleo/contrato.js';
import { pedirJson } from '../nucleo/http.js';
import { periodoDelMes } from './anthropic.js';

/**
 * Asientos, solicitudes y gasto de Cursor.
 *
 *   GET  /teams/members            -> quien ocupa asiento
 *   POST /teams/daily-usage-data   -> uso diario por persona
 *   GET  /teams/spend              -> gasto del equipo
 *
 * Se autentica con Basic usando la Team API key como usuario y contraseña
 * vacia, y hace falta permiso `admin:*` o `usage:*`.
 *
 * Cursor corta en veinte peticiones por minuto por equipo, asi que estas tres
 * consultas corren una sola vez por ciclo de cache, no por peticion del portal.
 */

const BASE = 'https://api.cursor.com';

interface MiembroCursor {
  email?: string;
  name?: string;
  role?: string;
  id?: string | number;
}

interface RespuestaMiembros {
  teamMembers?: MiembroCursor[];
  members?: MiembroCursor[];
}

interface FilaUso {
  email?: string;
  userEmail?: string;
  isActive?: boolean;
  totalApplies?: number;
  totalAccepts?: number;
  chatRequests?: number;
  composerRequests?: number;
}

interface RespuestaUso {
  data?: FilaUso[];
}

interface RespuestaGasto {
  teamMemberSpend?: { email?: string; spendCents?: number }[];
  totalMembers?: number;
}

function autorizacion(config: ConfiguracionCursor): Record<string, string> {
  const credencial = Buffer.from(`${config.apiKey}:`).toString('base64');
  return { authorization: `Basic ${credencial}` };
}

function persona(
  email: string | undefined,
  nombre: string | undefined
): Person {
  const correo = email ?? 'desconocido';
  return {
    id: correo,
    name: nombre || correo.split('@')[0] || correo,
    email: email
  };
}

/**
 * Cuenta las solicitudes de una fila de uso.
 *
 * Cursor reporta varias columnas segun el tipo de interaccion; para el portal
 * lo que importa es cuantas veces se uso, no de que clase fue cada una.
 */
export function solicitudesDe(fila: FilaUso): number {
  return (
    (fila.chatRequests ?? 0) +
    (fila.composerRequests ?? 0) +
    (fila.totalApplies ?? 0)
  );
}

/** Junta las filas diarias en un consumo por persona. */
export function agruparUso(
  respuesta: RespuestaUso
): Map<string, { usado: number; activo: boolean }> {
  const porPersona = new Map<string, { usado: number; activo: boolean }>();
  for (const fila of respuesta.data ?? []) {
    const email = fila.email ?? fila.userEmail;
    if (!email) {
      continue;
    }
    const actual = porPersona.get(email) ?? { usado: 0, activo: false };
    actual.usado += solicitudesDe(fila);
    // Basta con que haya tenido actividad un solo dia del periodo.
    actual.activo =
      actual.activo || fila.isActive === true || solicitudesDe(fila) > 0;
    porPersona.set(email, actual);
  }
  return porPersona;
}

export async function licenciasCursor(
  config: ConfiguracionCursor,
  ahora = new Date()
): Promise<LicenseUsage[]> {
  const { inicio, fin } = periodoDelMes(ahora);

  const [miembros, uso, gasto] = await Promise.all([
    pedirJson<RespuestaMiembros>('Cursor', `${BASE}/teams/members`, {
      encabezados: autorizacion(config)
    }),
    pedirJson<RespuestaUso>('Cursor', `${BASE}/teams/daily-usage-data`, {
      metodo: 'POST',
      encabezados: autorizacion(config),
      cuerpo: { startDate: Date.parse(inicio), endDate: Date.parse(fin) }
    }),
    pedirJson<RespuestaGasto>('Cursor', `${BASE}/teams/spend`, {
      encabezados: autorizacion(config)
    })
  ]);

  const lista = miembros.teamMembers ?? miembros.members ?? [];
  const porPersona = agruparUso(uso);
  const actualizado = ahora.toISOString();

  const asientos: LicenseMember[] = lista.map((miembro) => {
    const registro = miembro.email ? porPersona.get(miembro.email) : undefined;
    return {
      person: persona(miembro.email, miembro.name),
      used: 1,
      // Un asiento ocupado por alguien que no lo usa es dinero tirado, y esa
      // es justo la pregunta que la vista de licencias contesta.
      active: registro?.activo ?? false
    };
  });

  const gastoCentavos = (gasto.teamMemberSpend ?? []).reduce(
    (suma, fila) => suma + (fila.spendCents ?? 0),
    0
  );

  const licencias: LicenseUsage[] = [
    {
      id: 'cursor-asientos',
      provider: 'cursor',
      product: 'Cursor',
      plan: config.asientosContratados
        ? `${config.asientosContratados} asientos`
        : 'Equipo',
      unit: 'asientos',
      used: asientos.length,
      limit: config.asientosContratados,
      periodStart: inicio,
      periodEnd: fin,
      cost:
        gastoCentavos > 0
          ? Math.round(gastoCentavos) / 100
          : config.costoMensual,
      currency: 'USD',
      renewsAt: config.renuevaEn,
      manual: config.asientosContratados !== undefined,
      members: asientos,
      accountId: config.accountId,
      url: 'https://cursor.com/dashboard',
      updatedAt: actualizado
    }
  ];

  const totalSolicitudes = [...porPersona.values()].reduce(
    (suma, fila) => suma + fila.usado,
    0
  );
  if (totalSolicitudes > 0) {
    licencias.push({
      id: 'cursor-solicitudes',
      provider: 'cursor',
      product: 'Cursor · solicitudes del periodo',
      unit: 'solicitudes',
      used: totalSolicitudes,
      limit: config.solicitudesIncluidas,
      periodStart: inicio,
      periodEnd: fin,
      manual: config.solicitudesIncluidas !== undefined,
      members: [...porPersona.entries()]
        .map(([email, fila]) => ({
          person: persona(email, undefined),
          used: fila.usado,
          active: fila.activo
        }))
        .sort((a, b) => b.used - a.used),
      accountId: config.accountId,
      url: 'https://cursor.com/dashboard',
      updatedAt: actualizado
    });
  }

  return licencias;
}
