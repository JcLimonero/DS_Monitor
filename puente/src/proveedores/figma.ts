import type { ConfiguracionFigma } from '../config/entorno.js';
import type { LicenseMember, LicenseUsage } from '../nucleo/contrato.js';
import { pedirJson } from '../nucleo/http.js';
import { periodoDelMes } from './anthropic.js';

/**
 * Asientos de Figma.
 *
 * Aqui hay un limite que conviene tener claro: **Figma no publica facturacion
 * ni asientos contratados por API**. No hay endpoint de plan, de costo ni de
 * renovacion.
 *
 * Lo que si se puede leer:
 *
 *   GET /v1/teams/{team_id}/members  -> quien pertenece al equipo
 *
 * Con eso se cuentan los asientos ocupados. El tope contratado, el costo y la
 * fecha de renovacion se capturan en el entorno (`FIGMA_ASIENTOS`,
 * `FIGMA_COSTO_MENSUAL`, `FIGMA_RENUEVA_EN`), y por eso la licencia sale con
 * `manual: true`: el portal la marca como capturada a mano en vez de
 * presentarla como dato vivo del proveedor.
 *
 * En organizaciones Enterprise se podria saber ademas quien estuvo activo con
 * /v1/activity_logs (permiso `org:activity_log_read`); mientras eso no se
 * configure, todos los asientos se reportan como activos porque no hay forma de
 * afirmar lo contrario.
 */

const BASE = 'https://api.figma.com/v1';

interface MiembroFigma {
  id?: string;
  handle?: string;
  email?: string;
  img_url?: string;
}

interface RespuestaMiembros {
  members?: MiembroFigma[];
}

export function miembrosAAsientos(
  respuesta: RespuestaMiembros
): LicenseMember[] {
  return (respuesta.members ?? []).map((miembro) => ({
    person: {
      id: miembro.id ?? miembro.email ?? miembro.handle ?? 'desconocido',
      name: miembro.handle ?? miembro.email ?? 'Sin nombre',
      email: miembro.email
    },
    used: 1,
    // Sin activity logs no hay manera de saber quien no lo usa, y marcar a
    // todos como inactivos seria peor que no afirmar nada.
    active: true
  }));
}

export async function licenciasFigma(
  config: ConfiguracionFigma,
  ahora = new Date()
): Promise<LicenseUsage[]> {
  const respuesta = await pedirJson<RespuestaMiembros>(
    'Figma',
    `${BASE}/teams/${encodeURIComponent(config.teamId)}/members`,
    { encabezados: { 'x-figma-token': config.token } }
  );

  const asientos = miembrosAAsientos(respuesta);
  const { inicio, fin } = periodoDelMes(ahora);

  return [
    {
      id: 'figma-asientos',
      provider: 'figma',
      product: 'Figma',
      plan: 'Asientos de edición',
      unit: 'asientos',
      used: asientos.length,
      limit: config.asientosContratados,
      periodStart: inicio,
      periodEnd: fin,
      cost: config.costoMensual,
      currency: config.costoMensual !== undefined ? 'USD' : undefined,
      renewsAt: config.renuevaEn,
      // Siempre manual: el tope y el costo no vienen del proveedor.
      manual: true,
      members: asientos,
      accountId: config.accountId,
      url: 'https://www.figma.com/files',
      updatedAt: ahora.toISOString()
    }
  ];
}
