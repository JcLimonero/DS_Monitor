import type { ConfiguracionOdoo } from '../config/entorno.js';
import type {
  CrmActivity,
  CrmActivityType,
  CrmOpportunity,
  CrmStage,
  TaskItem,
  TaskPriority
} from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';
import { pedirJson } from '../nucleo/http.js';

/**
 * CRM de Odoo por JSON-RPC.
 *
 * Odoo no tiene REST: todo pasa por `POST /jsonrpc` con `service` y `method`.
 * Primero se autentica contra `common.authenticate`, que devuelve el id de
 * usuario, y con ese id se llaman los modelos con `object.execute_kw`.
 *
 * Hace falta un usuario con lectura sobre `crm.lead` y `mail.activity`, la URL
 * de la instancia y el nombre de la base. Se recomienda una clave de API en
 * lugar de la contraseña del usuario.
 */

interface RespuestaRpc<T> {
  result?: T;
  error?: { message?: string; data?: { message?: string } };
}

async function llamar<T>(
  config: ConfiguracionOdoo,
  parametros: unknown
): Promise<T> {
  const respuesta = await pedirJson<RespuestaRpc<T>>(
    'Odoo',
    `${config.url}/jsonrpc`,
    {
      metodo: 'POST',
      cuerpo: {
        jsonrpc: '2.0',
        method: 'call',
        params: parametros,
        id: Date.now()
      }
    }
  );

  if (respuesta.error) {
    // Odoo responde 200 con el error dentro del cuerpo, asi que si no se mira
    // aqui el fallo pasa como exito con datos vacios.
    const mensaje =
      respuesta.error.data?.message ??
      respuesta.error.message ??
      'error sin detalle';
    throw new ErrorProveedor('Odoo', mensaje);
  }

  if (respuesta.result === undefined) {
    throw new ErrorProveedor('Odoo', 'respondió sin resultado');
  }

  return respuesta.result;
}

async function autenticar(config: ConfiguracionOdoo): Promise<number> {
  const uid = await llamar<number | false>(config, {
    service: 'common',
    method: 'authenticate',
    args: [config.db, config.usuario, config.apiKey, {}]
  });

  if (!uid) {
    throw new ErrorProveedor('Odoo', 'no aceptó el usuario o la clave', 502);
  }
  return uid;
}

function buscarLeer<T>(
  config: ConfiguracionOdoo,
  uid: number,
  modelo: string,
  dominio: unknown[],
  campos: string[],
  limite = 200
): Promise<T[]> {
  return llamar<T[]>(config, {
    service: 'object',
    method: 'execute_kw',
    args: [
      config.db,
      uid,
      config.apiKey,
      modelo,
      'search_read',
      [dominio],
      { fields: campos, limit: limite }
    ]
  });
}

/**
 * Traduce la etapa de Odoo a la del portal.
 *
 * Las etapas de Odoo las nombra cada quien en su instancia, asi que se comparan
 * por palabras en lugar de por identificador: lo que no reconoce cae en
 * `nuevo`, que es la lectura mas conservadora del embudo.
 */
export function etapaDesdeOdoo(
  nombre: string,
  ganada: boolean,
  perdida: boolean
): CrmStage {
  if (ganada) {
    return 'ganado';
  }
  if (perdida) {
    return 'perdido';
  }
  const limpio = nombre.toLowerCase();
  if (limpio.includes('negocia')) {
    return 'negociacion';
  }
  if (limpio.includes('propuesta') || limpio.includes('cotiza')) {
    return 'propuesta';
  }
  if (limpio.includes('calific')) {
    return 'calificado';
  }
  return 'nuevo';
}

export function tipoActividad(nombre: string): CrmActivityType {
  const limpio = nombre.toLowerCase();
  if (limpio.includes('llamada') || limpio.includes('call')) {
    return 'llamada';
  }
  if (
    limpio.includes('correo') ||
    limpio.includes('email') ||
    limpio.includes('mail')
  ) {
    return 'correo';
  }
  if (
    limpio.includes('reunion') ||
    limpio.includes('reunión') ||
    limpio.includes('meeting')
  ) {
    return 'reunion';
  }
  return 'tarea';
}

/** Odoo devuelve los campos de relación como `[id, nombre]` o `false`. */
type Relacion = [number, string] | false;

function nombreRelacion(relacion: Relacion | undefined): string | undefined {
  return Array.isArray(relacion) ? relacion[1] : undefined;
}

function idRelacion(relacion: Relacion | undefined): number | undefined {
  return Array.isArray(relacion) ? relacion[0] : undefined;
}

interface LeadOdoo {
  id: number;
  name?: string;
  partner_id?: Relacion;
  stage_id?: Relacion;
  expected_revenue?: number;
  probability?: number;
  date_deadline?: string | false;
  user_id?: Relacion;
  write_date?: string;
  company_currency?: Relacion;
}

interface ActividadOdoo {
  id: number;
  summary?: string | false;
  activity_type_id?: Relacion;
  date_deadline?: string;
  user_id?: Relacion;
  res_id?: number;
  res_model?: string;
  res_name?: string | false;
}

/** Odoo entrega las fechas como "AAAA-MM-DD" o "AAAA-MM-DD hh:mm:ss", en UTC. */
export function fechaOdooAIso(
  valor: string | false | undefined
): string | undefined {
  if (!valor) {
    return undefined;
  }
  const normalizada = valor.includes(' ')
    ? valor.replace(' ', 'T')
    : `${valor}T12:00:00`;
  const fecha = new Date(`${normalizada}Z`);
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString();
}

export async function crmOdoo(
  config: ConfiguracionOdoo
): Promise<{ oportunidades: CrmOpportunity[]; actividades: CrmActivity[] }> {
  const uid = await autenticar(config);

  const [leads, actividades] = await Promise.all([
    buscarLeer<LeadOdoo>(
      config,
      uid,
      'crm.lead',
      [['type', '=', 'opportunity']],
      [
        'name',
        'partner_id',
        'stage_id',
        'expected_revenue',
        'probability',
        'date_deadline',
        'user_id',
        'write_date'
      ]
    ),
    buscarLeer<ActividadOdoo>(
      config,
      uid,
      'mail.activity',
      [['res_model', '=', 'crm.lead']],
      [
        'summary',
        'activity_type_id',
        'date_deadline',
        'user_id',
        'res_id',
        'res_model',
        'res_name'
      ]
    )
  ]);

  const nombrePorLead = new Map(
    leads.map((lead) => [lead.id, lead.name ?? 'Sin nombre'])
  );

  return {
    oportunidades: leads.map((lead) => {
      const etapa = nombreRelacion(lead.stage_id) ?? '';
      const probabilidad = lead.probability ?? 0;
      return {
        id: String(lead.id),
        name: lead.name ?? 'Sin nombre',
        partner: nombreRelacion(lead.partner_id) ?? 'Sin cliente',
        // Odoo marca ganado y perdido con la probabilidad en los extremos.
        stage: etapaDesdeOdoo(
          etapa,
          probabilidad >= 100,
          probabilidad <= 0 && etapa !== ''
        ),
        amount: lead.expected_revenue ?? 0,
        currency: nombreRelacion(lead.company_currency) ?? 'MXN',
        probability: Math.round(probabilidad),
        expectedClose: fechaOdooAIso(lead.date_deadline),
        salesperson: Array.isArray(lead.user_id)
          ? { id: String(lead.user_id[0]), name: lead.user_id[1] }
          : undefined,
        accountId: config.accountId,
        url: `${config.url}/odoo/crm/${lead.id}`,
        updatedAt: fechaOdooAIso(lead.write_date) ?? new Date().toISOString()
      };
    }),
    actividades: actividades.map((actividad) => ({
      id: String(actividad.id),
      summary:
        (actividad.summary || nombreRelacion(actividad.activity_type_id)) ??
        'Actividad',
      type: tipoActividad(nombreRelacion(actividad.activity_type_id) ?? ''),
      dueDate:
        fechaOdooAIso(actividad.date_deadline) ?? new Date().toISOString(),
      responsible: Array.isArray(actividad.user_id)
        ? { id: String(actividad.user_id[0]), name: actividad.user_id[1] }
        : undefined,
      opportunityId: actividad.res_id ? String(actividad.res_id) : undefined,
      opportunityName:
        (actividad.res_name || undefined) ??
        (actividad.res_id ? nombrePorLead.get(actividad.res_id) : undefined),
      accountId: config.accountId,
      url: actividad.res_id
        ? `${config.url}/odoo/crm/${actividad.res_id}`
        : undefined
    }))
  };
}

/**
 * Las actividades del CRM vistas como pendientes.
 *
 * El portal le pide a la conexion de Odoo tanto `crm` como `tasks`: una
 * actividad programada en el CRM es un pendiente igual que cualquier otro, y
 * quien la tiene asignada la quiere ver junto con los del tablero de Ops, no en
 * una pantalla aparte.
 */
export function actividadesComoPendientes(
  actividades: CrmActivity[],
  accountId: string,
  ahora = new Date()
): TaskItem[] {
  return actividades.map((actividad) => ({
    id: `odoo-${actividad.id}`,
    title: actividad.summary,
    description: actividad.opportunityName,
    // Odoo no marca una actividad como terminada: al cerrarla desaparece, asi
    // que todas las que llegan siguen abiertas.
    status: 'pendiente',
    priority: prioridadPorVencimiento(actividad.dueDate, ahora),
    dueDate: actividad.dueDate,
    assignee: actividad.responsible,
    accountId,
    origin: 'odoo',
    project: 'CRM',
    url: actividad.url,
    tags: ['crm', actividad.type],
    updatedAt: ahora.toISOString()
  }));
}

/**
 * Odoo no le pone prioridad a las actividades, asi que se deduce de que tan
 * cerca esta el vencimiento. Es una aproximacion, pero ordena la lista mejor
 * que ponerlas todas en media.
 */
export function prioridadPorVencimiento(
  vencimiento: string,
  ahora = new Date()
): TaskPriority {
  const dias = Math.ceil(
    (new Date(vencimiento).getTime() - ahora.getTime()) / 86_400_000
  );
  if (dias <= 0) {
    return 'urgente';
  }
  if (dias <= 2) {
    return 'alta';
  }
  return dias <= 7 ? 'media' : 'baja';
}

/** Se exporta solo para que las pruebas puedan leerlo sin red. */
export const _internos = { idRelacion };
