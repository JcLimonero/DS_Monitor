import type { ConfiguracionGoogle } from '../config/entorno.js';
import type { Meeting, MeetingStatus, Person } from '../nucleo/contrato.js';
import { ErrorProveedor } from '../nucleo/errores.js';
import { conParametros, pedirJson } from '../nucleo/http.js';

/**
 * Cuentas de Google (Gmail) por OAuth.
 *
 * Una aplicacion OAuth de Google Cloud (client ID y secret), el consentimiento
 * de la persona desde el modulo Correo, y un refresh token que el puente guarda
 * y renueva. El token de acceso sirve para dos cosas: entrar a Gmail por IMAP
 * con XOAUTH2 (sin contraseña de aplicacion) y leer el calendario completo con
 * la API de Google Calendar.
 *
 * Permisos que pide: `https://mail.google.com/` (IMAP) y
 * `calendar.readonly`. El primero es "restringido" para Google: mientras la
 * aplicacion este en modo de prueba, el refresh token vence a los siete dias
 * y hay que volver a conectar; publicarla requiere la verificacion de Google.
 */

const ALCANCES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

const DIAS_CALENDARIO_ATRAS = 7;
const DIAS_CALENDARIO_ADELANTE = 45;

export function urlDeAutorizacionGoogle(
  app: ConfiguracionGoogle,
  redirectUri: string,
  state: string,
  usuario?: string
): string {
  const parametros = new URLSearchParams({
    client_id: app.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: ALCANCES,
    state,
    // Sin esto Google no entrega refresh token la segunda vez.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true'
  });
  if (usuario) {
    parametros.set('login_hint', usuario);
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${parametros}`;
}

interface RespuestaToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function pedirToken(
  app: ConfiguracionGoogle,
  cuerpo: Record<string, string>
): Promise<RespuestaToken> {
  const respuesta = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...cuerpo
    })
  });
  const datos = (await respuesta.json().catch(() => ({}))) as RespuestaToken;
  if (!respuesta.ok || !datos.access_token) {
    throw new ErrorProveedor(
      'google',
      `${datos.error ?? respuesta.status}: ${(datos.error_description ?? 'no entrego token').slice(0, 200)}`
    );
  }
  return datos;
}

export async function canjearCodigoGoogle(
  app: ConfiguracionGoogle,
  codigo: string,
  redirectUri: string
): Promise<{ refreshToken: string; accessToken: string }> {
  const datos = await pedirToken(app, {
    grant_type: 'authorization_code',
    code: codigo,
    redirect_uri: redirectUri
  });
  if (!datos.refresh_token) {
    throw new ErrorProveedor(
      'google',
      'no entrego refresh token: revoca el acceso de la aplicación en la cuenta de Google y vuelve a conectar'
    );
  }
  return {
    refreshToken: datos.refresh_token,
    accessToken: datos.access_token as string
  };
}

const accesos = new Map<string, { token: string; venceEn: number }>();

export async function tokenDeAccesoGoogle(
  id: string,
  app: ConfiguracionGoogle
): Promise<string> {
  const vigente = accesos.get(id);
  if (vigente && vigente.venceEn > Date.now() + 60_000) {
    return vigente.token;
  }
  if (!app.refreshToken) {
    throw new ErrorProveedor(
      'google',
      'la cuenta no está conectada: falta pasar por "Conectar con Google" en Correo',
      503
    );
  }
  const datos = await pedirToken(app, {
    grant_type: 'refresh_token',
    refresh_token: app.refreshToken
  });
  const token = datos.access_token as string;
  accesos.set(id, {
    token,
    venceEn: Date.now() + (datos.expires_in ?? 3600) * 1000
  });
  return token;
}

export function olvidarAccesoGoogle(id: string): void {
  accesos.delete(id);
}

export async function quienSoyGoogle(accessToken: string): Promise<string> {
  const yo = await pedirJson<{ email?: string; name?: string }>(
    'google',
    'https://www.googleapis.com/oauth2/v3/userinfo',
    { encabezados: { authorization: `Bearer ${accessToken}` } }
  );
  return yo.email ?? yo.name ?? '(sin nombre)';
}

interface EventoGoogle {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: {
    email?: string;
    displayName?: string;
    self?: boolean;
    responseStatus?: string;
  }[];
  location?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { uri?: string; entryPointType?: string }[];
  };
  description?: string;
}

/** El calendario principal, de una semana atras a mes y medio adelante. */
export async function calendarioGoogle(
  accessToken: string,
  accountId: string,
  ahora = new Date()
): Promise<Meeting[]> {
  const juntas: Meeting[] = [];
  let pagina: string | undefined;
  do {
    const respuesta = await pedirJson<{
      items?: EventoGoogle[];
      nextPageToken?: string;
    }>(
      'google',
      conParametros(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          timeMin: new Date(
            ahora.getTime() - DIAS_CALENDARIO_ATRAS * 86_400_000
          ).toISOString(),
          timeMax: new Date(
            ahora.getTime() + DIAS_CALENDARIO_ADELANTE * 86_400_000
          ).toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '250',
          ...(pagina ? { pageToken: pagina } : {})
        }
      ),
      { encabezados: { authorization: `Bearer ${accessToken}` } }
    );
    for (const evento of respuesta.items ?? []) {
      const junta = juntaDeEventoGoogle(evento, accountId);
      if (junta) {
        juntas.push(junta);
      }
    }
    pagina = respuesta.nextPageToken;
  } while (pagina);
  return juntas;
}

export function juntaDeEventoGoogle(
  evento: EventoGoogle,
  accountId: string
): Meeting | undefined {
  const todoElDia = !!evento.start?.date;
  const start = evento.start?.dateTime ?? evento.start?.date;
  const end = evento.end?.dateTime ?? evento.end?.date;
  if (!start || !end) {
    return undefined;
  }
  const yo = evento.attendees?.find((a) => a.self);
  const respuesta = yo?.responseStatus ?? 'accepted';
  const estado: MeetingStatus =
    evento.status === 'cancelled'
      ? 'cancelada'
      : respuesta === 'needsAction' || respuesta === 'tentative'
        ? 'tentativa'
        : 'confirmada';
  const video =
    evento.hangoutLink ??
    evento.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === 'video'
    )?.uri;
  return {
    id: `${accountId}-${evento.id}`,
    title: evento.summary || '(sin título)',
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    allDay: todoElDia,
    accountId,
    status: estado,
    organizer: persona(evento.organizer),
    attendees: (evento.attendees ?? [])
      .map((a) => persona(a))
      .filter((p): p is Person => p !== undefined),
    location: evento.location || undefined,
    joinUrl: video ?? undefined,
    notes: evento.description?.trim().slice(0, 500) || undefined
  };
}

function persona(
  d: { email?: string; displayName?: string } | undefined
): Person | undefined {
  const email = d?.email?.toLowerCase();
  if (!email) {
    return undefined;
  }
  return { id: email, name: d?.displayName || email, email };
}
