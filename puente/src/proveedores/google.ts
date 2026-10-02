import type { ConfiguracionGoogle } from '../config/entorno.js';
import type { Meeting, MeetingStatus, Person } from '../nucleo/contrato.js';
import { ErrorProveedor, ErrorReconectarGoogle } from '../nucleo/errores.js';
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
 * Permisos que pide: `https://mail.google.com/` (IMAP), `calendar.readonly` y
 * `drive.file` (solo los archivos que la propia aplicacion crea: la carpeta
 * de las llamadas archivadas y sus Docs; no ve el resto del Drive). El primero
 * es "restringido" para Google: mientras la aplicacion este en modo de prueba,
 * el refresh token vence a los siete dias y hay que volver a conectar;
 * publicarla requiere la verificacion de Google.
 *
 * Las cuentas conectadas antes de agregar `drive.file` no lo tienen: hay que
 * volver a pasar por "Conectar con Google".
 */

export const ALCANCE_DRIVE = 'https://www.googleapis.com/auth/drive.file';

const ALCANCES = [
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar.readonly',
  ALCANCE_DRIVE,
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
  /** Los permisos que Google dice haber dado, separados por espacio. */
  scope?: string;
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

const accesos = new Map<
  string,
  { token: string; venceEn: number; alcance?: string }
>();

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
    venceEn: Date.now() + (datos.expires_in ?? 3600) * 1000,
    alcance: datos.scope
  });
  return token;
}

/**
 * El token para Drive. Si Google dijo que a este refresh token no se le dio
 * `drive.file` (cuenta conectada antes de pedirlo), falla de una vez con el
 * aviso de reconectar, sin gastar una llamada a Drive.
 */
export async function tokenDeDriveGoogle(
  id: string,
  app: ConfiguracionGoogle
): Promise<string> {
  const token = await tokenDeAccesoGoogle(id, app);
  const alcance = accesos.get(id)?.alcance;
  if (alcance !== undefined && !alcance.split(' ').includes(ALCANCE_DRIVE)) {
    throw new ErrorReconectarGoogle();
  }
  return token;
}

/**
 * Si el ultimo token que entrego Google trae el permiso de Drive: `undefined`
 * cuando todavia no se ha pedido ninguno (o Google no dijo los permisos).
 */
export function tienePermisoDrive(id: string): boolean | undefined {
  const alcance = accesos.get(id)?.alcance;
  return alcance === undefined
    ? undefined
    : alcance.split(' ').includes(ALCANCE_DRIVE);
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

// --- Google Drive ---------------------------------------------------------

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const MIME_CARPETA = 'application/vnd.google-apps.folder';
const MIME_DOCUMENTO = 'application/vnd.google-apps.document';
const TIEMPO_DRIVE_MS = 60_000;

/** Lo que se sabe de un archivo de Drive (los campos que se piden). */
export interface ArchivoDrive {
  id: string;
  name?: string;
  mimeType?: string;
  trashed?: boolean;
  parents?: string[];
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

/** Escapa un valor para ponerlo entre comillas simples en `q` de Drive. */
export function escaparConsultaDrive(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function pedirDrive<T>(
  token: string,
  url: string,
  init: { method?: string; body?: string; contentType?: string } = {}
): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.contentType ? { 'content-type': init.contentType } : {})
      },
      body: init.body,
      signal: AbortSignal.timeout(TIEMPO_DRIVE_MS)
    });
  } catch (error) {
    throw new ErrorProveedor(
      'google',
      `Drive no respondió: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!respuesta.ok) {
    const texto = await respuesta.text().catch(() => '');
    let razon = '';
    let mensaje = texto.slice(0, 200);
    try {
      const j = JSON.parse(texto) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      razon = j.error?.errors?.[0]?.reason ?? '';
      mensaje = j.error?.message ?? mensaje;
    } catch {
      // No era JSON: se queda el texto recortado.
    }
    if (
      respuesta.status === 403 &&
      (razon === 'insufficientPermissions' ||
        /insufficient|scope/i.test(mensaje))
    ) {
      throw new ErrorReconectarGoogle(mensaje.slice(0, 120));
    }
    if (respuesta.status === 403 && razon === 'accessNotConfigured') {
      throw new ErrorProveedor(
        'google',
        'la API de Google Drive no está activada en el proyecto de Google Cloud de la aplicación: actívala en APIs y servicios → Biblioteca'
      );
    }
    throw new ErrorProveedor(
      'google',
      `Drive respondió ${respuesta.status}${mensaje ? ` · ${mensaje}` : ''}`,
      502,
      { http: respuesta.status }
    );
  }
  return (await respuesta.json()) as T;
}

const CAMPOS_ARCHIVO =
  'id,name,mimeType,trashed,parents,webViewLink,appProperties';

/**
 * La carpeta de la aplicacion con ese nombre; si no existe, la crea. Con el
 * permiso `drive.file` solo se ven las carpetas que creo la propia
 * aplicacion, asi que no hay riesgo de tomar una ajena.
 */
export async function carpetaDeDrive(
  token: string,
  nombre: string
): Promise<string> {
  const q = `mimeType='${MIME_CARPETA}' and name='${escaparConsultaDrive(nombre)}' and trashed=false`;
  const lista = await pedirDrive<{ files?: ArchivoDrive[] }>(
    token,
    conParametros(`${DRIVE}/files`, {
      q,
      fields: 'files(id,name)',
      spaces: 'drive',
      pageSize: '1'
    })
  );
  const existente = lista.files?.[0];
  if (existente?.id) {
    return existente.id;
  }
  const creada = await pedirDrive<ArchivoDrive>(
    token,
    conParametros(`${DRIVE}/files`, { fields: 'id' }),
    {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ name: nombre, mimeType: MIME_CARPETA })
    }
  );
  if (!creada.id) {
    throw new ErrorProveedor('google', 'Drive no devolvió el id de la carpeta');
  }
  return creada.id;
}

/**
 * Sube un texto plano y Drive lo convierte en Google Doc (`mimeType` del
 * documento en los metadatos). `propiedades` queda en el archivo y sirve para
 * encontrarlo despues (por ejemplo, el id de la transcripcion).
 */
export async function subirComoDocumento(
  token: string,
  carpetaId: string,
  nombre: string,
  textoPlano: string,
  propiedades: Record<string, string> = {}
): Promise<{ id: string; webViewLink: string }> {
  const frontera = `ds-monitor-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const metadatos = JSON.stringify({
    name: nombre,
    mimeType: MIME_DOCUMENTO,
    parents: [carpetaId],
    appProperties: propiedades
  });
  const cuerpo =
    `--${frontera}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadatos}\r\n` +
    `--${frontera}\r\ncontent-type: text/plain; charset=UTF-8\r\n\r\n${textoPlano}\r\n` +
    `--${frontera}--`;
  const creado = await pedirDrive<{ id?: string; webViewLink?: string }>(
    token,
    conParametros(`${DRIVE_SUBIDA}/files`, {
      uploadType: 'multipart',
      fields: 'id,webViewLink'
    }),
    {
      method: 'POST',
      contentType: `multipart/related; boundary=${frontera}`,
      body: cuerpo
    }
  );
  if (!creado.id) {
    throw new ErrorProveedor('google', 'Drive no devolvió el id del documento');
  }
  return {
    id: creado.id,
    webViewLink:
      creado.webViewLink ??
      `https://docs.google.com/document/d/${creado.id}/edit`
  };
}

/** Los metadatos de un archivo; sirve para comprobar que quedo donde debe. */
export async function archivoDeDrive(
  token: string,
  id: string
): Promise<ArchivoDrive> {
  return pedirDrive<ArchivoDrive>(
    token,
    conParametros(`${DRIVE}/files/${encodeURIComponent(id)}`, {
      fields: CAMPOS_ARCHIVO
    })
  );
}

/** El documento de esa propiedad en la carpeta, si una corrida anterior ya lo subio. */
export async function documentoPorPropiedad(
  token: string,
  carpetaId: string,
  clave: string,
  valor: string
): Promise<ArchivoDrive | undefined> {
  const q = `'${escaparConsultaDrive(carpetaId)}' in parents and trashed=false and appProperties has { key='${escaparConsultaDrive(clave)}' and value='${escaparConsultaDrive(valor)}' }`;
  const lista = await pedirDrive<{ files?: ArchivoDrive[] }>(
    token,
    conParametros(`${DRIVE}/files`, {
      q,
      fields: `files(${CAMPOS_ARCHIVO})`,
      spaces: 'drive',
      pageSize: '1'
    })
  );
  return lista.files?.[0];
}

/** El texto plano de un Google Doc, para comprobar que el contenido quedo completo. */
export async function textoDeDocumento(
  token: string,
  id: string
): Promise<string> {
  const respuesta = await fetch(
    conParametros(`${DRIVE}/files/${encodeURIComponent(id)}/export`, {
      mimeType: 'text/plain'
    }),
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIEMPO_DRIVE_MS)
    }
  );
  if (!respuesta.ok) {
    throw new ErrorProveedor(
      'google',
      `Drive no exportó el documento (${respuesta.status})`
    );
  }
  return respuesta.text();
}
