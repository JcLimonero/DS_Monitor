import type {
  ConfiguracionCorreo,
  ConfiguracionMicrosoft
} from '../config/entorno.js';
import type { Meeting, MeetingStatus, Person } from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';
import { pedirJson } from '../nucleo/http.js';
import {
  detectarLicenciasConEvidencia,
  detectarPendientes,
  montoDelRecibo,
  type DatosCorreo
} from './correo.js';
import type { EncabezadoCorreo } from './imap.js';
import { sinEtiquetas } from './mime.js';

/**
 * Buzones de Microsoft por Microsoft Graph.
 *
 * Microsoft ya no acepta IMAP con contraseña, asi que se entra como lo pide
 * Microsoft: una aplicacion registrada en Entra ID, el consentimiento de la
 * persona (una sola vez, desde Ajustes) y un refresh token que el puente
 * guarda y renueva. Con eso se leen los correos (`/me/messages`) y, mejor
 * que las invitaciones sueltas, el calendario completo (`/me/calendarView`).
 *
 * Permisos delegados que pide: Mail.Read, Calendars.Read, User.Read y
 * offline_access (para el refresh token).
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ALCANCES = 'offline_access User.Read Mail.Read Calendars.Read';

/** Cuantos correos como maximo se traen por lectura. */
const MAXIMO_CORREOS = 6000;
const DIAS_CALENDARIO_ATRAS = 7;
const DIAS_CALENDARIO_ADELANTE = 45;

function autoridad(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0`;
}

/** A donde mandar a la persona para dar el consentimiento. */
export function urlDeAutorizacion(
  microsoft: ConfiguracionMicrosoft,
  redirectUri: string,
  state: string,
  usuario?: string
): string {
  const parametros = new URLSearchParams({
    client_id: microsoft.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: ALCANCES,
    state,
    prompt: 'select_account'
  });
  if (usuario) {
    parametros.set('login_hint', usuario);
  }
  return `${autoridad(microsoft.tenant)}/authorize?${parametros}`;
}

interface RespuestaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function pedirToken(
  microsoft: ConfiguracionMicrosoft,
  cuerpo: Record<string, string>
): Promise<RespuestaToken> {
  const respuesta = await fetch(`${autoridad(microsoft.tenant)}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: microsoft.clientId,
      client_secret: microsoft.clientSecret,
      scope: ALCANCES,
      ...cuerpo
    })
  });
  const datos = (await respuesta.json().catch(() => ({}))) as RespuestaToken;
  if (!respuesta.ok || !datos.access_token) {
    throw new ErrorProveedor(
      'microsoft',
      `${datos.error ?? respuesta.status}: ${recortar(datos.error_description ?? 'no entrego token')}`
    );
  }
  return datos;
}

/** Cambia el codigo del regreso de OAuth por tokens. */
export async function canjearCodigo(
  microsoft: ConfiguracionMicrosoft,
  codigo: string,
  redirectUri: string
): Promise<{ refreshToken: string; accessToken: string }> {
  const datos = await pedirToken(microsoft, {
    grant_type: 'authorization_code',
    code: codigo,
    redirect_uri: redirectUri
  });
  if (!datos.refresh_token) {
    throw new ErrorProveedor(
      'microsoft',
      'no entrego refresh token: falta el permiso offline_access en la aplicación'
    );
  }
  return {
    refreshToken: datos.refresh_token,
    accessToken: datos.access_token as string
  };
}

/**
 * Comprueba client ID, secret y tenant sin ningun usuario de por medio: pide
 * un token de aplicacion. Que Graph lo entregue vacio de permisos no importa;
 * lo que se prueba es que Entra reconozca la aplicacion y el secreto.
 */
export async function comprobarAplicacionMicrosoft(
  app: Pick<ConfiguracionMicrosoft, 'tenant' | 'clientId' | 'clientSecret'>
): Promise<string> {
  const respuesta = await fetch(`${autoridad(app.tenant)}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default'
    })
  });
  if (respuesta.ok) {
    return 'Entra reconoce la aplicación y el secreto.';
  }
  const datos = (await respuesta.json().catch(() => ({}))) as RespuestaToken;
  const descripcion = datos.error_description ?? '';
  // Estos dos si son de la aplicacion: no existe, o el secreto esta mal.
  if (
    /AADSTS700016|AADSTS7000215|AADSTS7000222|AADSTS90002/.test(descripcion)
  ) {
    throw new ErrorProveedor(
      'microsoft',
      `${datos.error ?? respuesta.status}: ${recortar(descripcion)}`
    );
  }
  // Lo demas (politicas de acceso condicional, tenant "common" sin token de
  // aplicacion) no dice nada del secreto: la cuenta se prueba de verdad al
  // conectarla con el consentimiento del usuario.
  return `Entra reconoce la aplicación y el secreto (el token de aplicación lo bloquea una política: ${recortar(descripcion.split(' Trace ID')[0] ?? '')}). Conecta cada buzón con "Conectar con Microsoft".`;
}

/** Tokens de acceso vigentes, uno por buzon, para no pedir uno por peticion. */
const accesos = new Map<string, { token: string; venceEn: number }>();

async function tokenDeAcceso(
  id: string,
  microsoft: ConfiguracionMicrosoft
): Promise<string> {
  const vigente = accesos.get(id);
  if (vigente && vigente.venceEn > Date.now() + 60_000) {
    return vigente.token;
  }
  if (!microsoft.refreshToken) {
    throw new ErrorProveedor(
      'microsoft',
      'la cuenta no está conectada: falta pasar por "Conectar con Microsoft" en Ajustes',
      503
    );
  }
  const datos = await pedirToken(microsoft, {
    grant_type: 'refresh_token',
    refresh_token: microsoft.refreshToken
  });
  const token = datos.access_token as string;
  accesos.set(id, {
    token,
    venceEn: Date.now() + (datos.expires_in ?? 3600) * 1000
  });
  return token;
}

export function olvidarAcceso(id: string): void {
  accesos.delete(id);
}

async function graph<T>(
  token: string,
  ruta: string,
  encabezados: Record<string, string> = {}
): Promise<T> {
  return pedirJson<T>(
    'microsoft',
    ruta.startsWith('http') ? ruta : `${GRAPH}${ruta}`,
    {
      encabezados: { authorization: `Bearer ${token}`, ...encabezados }
    }
  );
}

interface Usuario {
  displayName?: string;
  mail?: string;
  userPrincipalName?: string;
}

/** Con que cuenta esta conectado el token. */
export async function quienSoy(
  id: string,
  microsoft: ConfiguracionMicrosoft,
  accessToken?: string
): Promise<string> {
  const token = accessToken ?? (await tokenDeAcceso(id, microsoft));
  const yo = await graph<Usuario>(token, '/me');
  return yo.mail ?? yo.userPrincipalName ?? yo.displayName ?? '(sin nombre)';
}

interface MensajeGraph {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

interface Pagina<T> {
  value?: T[];
  '@odata.nextLink'?: string;
}

interface EventoGraph {
  id: string;
  subject?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: { emailAddress?: { name?: string; address?: string } }[];
  location?: { displayName?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  bodyPreview?: string;
  responseStatus?: { response?: string };
}

/** Lee el buzon y el calendario de una cuenta de Microsoft ya conectada. */
export async function leerCorreoMicrosoft(
  config: ConfiguracionCorreo,
  ahora = new Date()
): Promise<DatosCorreo> {
  const microsoft = config.microsoft;
  if (!microsoft) {
    throw new ErrorProveedor(
      'microsoft',
      'faltan el client ID y el client secret de la aplicación de Entra ID',
      503
    );
  }
  const token = await tokenDeAcceso(config.id, microsoft);

  // --- Correos: solo encabezados, paginados ---
  const desde = new Date(
    ahora.getTime() - config.diasAtras * 86_400_000
  ).toISOString();
  const encabezados: EncabezadoCorreo[] = [];
  const idPorUid = new Map<number, string>();
  let siguiente: string | undefined =
    `/me/messages?$select=id,subject,receivedDateTime,from&$filter=receivedDateTime ge ${desde}&$orderby=receivedDateTime desc&$top=500`;
  while (siguiente && encabezados.length < MAXIMO_CORREOS) {
    const pagina: Pagina<MensajeGraph> = await graph<Pagina<MensajeGraph>>(
      token,
      siguiente
    );
    for (const mensaje of pagina.value ?? []) {
      const uid = encabezados.length + 1;
      idPorUid.set(uid, mensaje.id);
      const de = mensaje.from?.emailAddress;
      encabezados.push({
        uid,
        fecha: mensaje.receivedDateTime ?? '',
        remitente: de?.name
          ? `${de.name} <${de.address ?? ''}>`
          : (de?.address ?? ''),
        asunto: mensaje.subject ?? '',
        tipoContenido: ''
      });
    }
    siguiente = pagina['@odata.nextLink'];
  }

  // --- Licencias con importe, del cuerpo del ultimo recibo ---
  const evidencias = detectarLicenciasConEvidencia(
    encabezados,
    config.accountId,
    ahora
  );
  for (const evidencia of evidencias) {
    const idMensaje = idPorUid.get(evidencia.ultimo.uid);
    if (!idMensaje) {
      continue;
    }
    const mensaje = await graph<{
      body?: { content?: string; contentType?: string };
    }>(token, `/me/messages/${idMensaje}?$select=body`);
    const contenido = mensaje.body?.content ?? '';
    const texto =
      mensaje.body?.contentType === 'html'
        ? sinEtiquetas(contenido)
        : contenido;
    const monto = montoDelRecibo(
      texto,
      evidencia.ultimo.remitente,
      evidencia.moneda
    );
    if (monto) {
      evidencia.licencia.cost = monto.costo;
      evidencia.licencia.currency = monto.moneda;
      evidencia.licencia.used = monto.costo;
    }
  }

  // --- Calendario completo, no solo invitaciones ---
  const inicio = new Date(ahora.getTime() - DIAS_CALENDARIO_ATRAS * 86_400_000);
  const fin = new Date(ahora.getTime() + DIAS_CALENDARIO_ADELANTE * 86_400_000);
  const juntas: Meeting[] = [];
  let siguienteEvento: string | undefined =
    `/me/calendarView?startDateTime=${inicio.toISOString()}&endDateTime=${fin.toISOString()}` +
    `&$select=id,subject,start,end,isAllDay,isCancelled,organizer,attendees,location,onlineMeeting,webLink,bodyPreview,responseStatus&$top=200`;
  while (siguienteEvento) {
    const pagina: Pagina<EventoGraph> = await graph<Pagina<EventoGraph>>(
      token,
      siguienteEvento,
      { prefer: 'outlook.timezone="UTC"' }
    );
    for (const evento of pagina.value ?? []) {
      const junta = juntaDeEvento(evento, config.accountId);
      if (junta) {
        juntas.push(junta);
      }
    }
    siguienteEvento = pagina['@odata.nextLink'];
  }

  return {
    licencias: evidencias.map((e) => e.licencia),
    pendientes: detectarPendientes(encabezados, config.accountId, ahora),
    juntas: juntas.sort((a, b) => a.start.localeCompare(b.start)),
    leidos: encabezados.length
  };
}

export function juntaDeEvento(
  evento: EventoGraph,
  accountId: string
): Meeting | undefined {
  const start = fechaGraph(evento.start?.dateTime);
  const end = fechaGraph(evento.end?.dateTime);
  if (!start || !end) {
    return undefined;
  }
  return {
    id: `${accountId}-${evento.id}`,
    title: evento.subject || '(sin título)',
    start,
    end,
    allDay: evento.isAllDay === true,
    accountId,
    status: estadoDeEvento(evento),
    organizer: persona(evento.organizer?.emailAddress),
    attendees: (evento.attendees ?? [])
      .map((a) => persona(a.emailAddress))
      .filter((p): p is Person => p !== undefined),
    location: evento.location?.displayName || undefined,
    joinUrl: evento.onlineMeeting?.joinUrl ?? undefined,
    notes: evento.bodyPreview?.trim().slice(0, 500) || undefined
  };
}

function estadoDeEvento(evento: EventoGraph): MeetingStatus {
  if (evento.isCancelled) {
    return 'cancelada';
  }
  const respuesta = (evento.responseStatus?.response ?? '').toLowerCase();
  // Lo que uno no ha contestado, o contesto "tal vez", no es una junta firme.
  return respuesta === 'notresponded' || respuesta === 'tentativelyaccepted'
    ? 'tentativa'
    : 'confirmada';
}

/** Graph entrega `2026-09-18T16:00:00.0000000` sin zona; con Prefer UTC es UTC. */
function fechaGraph(valor: string | undefined): string | undefined {
  if (!valor) {
    return undefined;
  }
  const fecha = new Date(valor.endsWith('Z') ? valor : `${valor}Z`);
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString();
}

function persona(
  direccion: { name?: string; address?: string } | undefined
): Person | undefined {
  const email = direccion?.address?.toLowerCase();
  if (!email) {
    return undefined;
  }
  return { id: email, name: direccion?.name || email, email };
}

function recortar(texto: string): string {
  return texto.length > 200 ? `${texto.slice(0, 200)}…` : texto;
}
