import type { ConfiguracionCloudflare } from '../config/entorno.js';
import { ErrorProveedor } from '../nucleo/errores.js';

/**
 * Lee de Cloudflare (API v4, token bearer, SOLO lectura) los dominios (zonas)
 * y sus registros DNS, para ver de un vistazo que subdominios tiene cada uno.
 *
 * Permisos minimos del token: Zone → Zone → Read y Zone → DNS → Read. Las
 * fechas de vencimiento solo existen para los dominios registrados EN
 * Cloudflare Registrar (Account → Registrar: Domains → Read); si el token no
 * llega a eso, se sigue sin ellas y la fecha se captura a mano.
 */

const TIEMPO_LIMITE_MS = 15_000;
/** Lo mas que se espera un `Retry-After` antes de reintentar. */
const ESPERA_MAXIMA_MS = 10_000;
/** /zones acepta hasta 50 por pagina. */
const POR_PAGINA_ZONAS = 50;
/** /dns_records acepta mas, pero 100 es lo documentado por omision. */
const POR_PAGINA_REGISTROS = 100;
/** Tope de paginas por consulta: 100 x 100 = 10 000 registros por zona. */
export const MAXIMO_PAGINAS = 100;

const MENSAJE_PERMISO =
  'token sin permiso (necesita Zone:Read y DNS:Read). Revisa el token en Integraciones → Servicios → Cloudflare.';

/** El token no alcanza (401/403): la pantalla lo distingue de otras fallas. */
export class ErrorCloudflareSinPermiso extends ErrorProveedor {
  constructor() {
    super('cloudflare', MENSAJE_PERMISO);
    this.name = 'ErrorCloudflareSinPermiso';
  }
}

type Crudo = Record<string, unknown>;

interface Respuesta {
  result: unknown;
  paginas: number;
  total?: number;
}

const texto = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

const objeto = (v: unknown): Crudo | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Crudo) : undefined;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Segundos de un `Retry-After` (numero o fecha), acotados. */
function esperaDe(valor: string | null): number {
  if (!valor) {
    return 1000;
  }
  const segundos = Number(valor);
  const ms = Number.isFinite(segundos)
    ? segundos * 1000
    : Date.parse(valor) - Date.now();
  return Math.min(
    Math.max(Number.isFinite(ms) ? ms : 1000, 0),
    ESPERA_MAXIMA_MS
  );
}

function mensajeDe(cuerpo: unknown): string | undefined {
  const errores = objeto(cuerpo)?.['errors'];
  if (!Array.isArray(errores) || errores.length === 0) {
    return undefined;
  }
  return texto(objeto(errores[0])?.['message']);
}

/** Una peticion GET, con un reintento si Cloudflare pide esperar (429). */
async function pedir(
  config: ConfiguracionCloudflare,
  ruta: string,
  parametros: Record<string, string> = {}
): Promise<Respuesta> {
  const consulta = new URLSearchParams(parametros).toString();
  const url = `${config.apiUrl}${ruta}${consulta ? `?${consulta}` : ''}`;
  for (let intento = 0; ; intento++) {
    const control = new AbortController();
    const t = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);
    let r: Response;
    try {
      r = await fetch(url, {
        headers: {
          authorization: `Bearer ${config.token}`,
          accept: 'application/json'
        },
        signal: control.signal
      });
    } catch (error) {
      throw new ErrorProveedor(
        'cloudflare',
        `No se pudo hablar con Cloudflare: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(t);
    }
    if (r.status === 401 || r.status === 403) {
      throw new ErrorCloudflareSinPermiso();
    }
    if (r.status === 429) {
      if (intento === 0) {
        await dormir(esperaDe(r.headers.get('retry-after')));
        continue;
      }
      throw new ErrorProveedor(
        'cloudflare',
        'Cloudflare limitó las peticiones (429). Espera un momento y vuelve a intentar.',
        429
      );
    }
    let cuerpo: unknown;
    try {
      cuerpo = await r.json();
    } catch {
      cuerpo = undefined;
    }
    const sobre = objeto(cuerpo);
    if (!r.ok || sobre?.['success'] === false) {
      throw new ErrorProveedor(
        'cloudflare',
        `Cloudflare respondió ${r.status}${mensajeDe(cuerpo) ? `: ${mensajeDe(cuerpo)}` : ''}`
      );
    }
    const info = objeto(sobre?.['result_info']);
    return {
      result: sobre?.['result'],
      paginas: Number(info?.['total_pages']) || 1,
      total: Number.isFinite(Number(info?.['total_count']))
        ? Number(info?.['total_count'])
        : undefined
    };
  }
}

/** Todas las paginas de una lista (page / per_page / total_pages). */
async function pedirTodas(
  config: ConfiguracionCloudflare,
  ruta: string,
  porPagina: number,
  parametros: Record<string, string> = {}
): Promise<{ filas: Crudo[]; total: number; truncado: boolean }> {
  const filas: Crudo[] = [];
  let paginas = 1;
  let total: number | undefined;
  for (let pagina = 1; pagina <= Math.min(paginas, MAXIMO_PAGINAS); pagina++) {
    const r = await pedir(config, ruta, {
      ...parametros,
      page: String(pagina),
      per_page: String(porPagina)
    });
    paginas = r.paginas;
    total = r.total ?? total;
    for (const fila of Array.isArray(r.result) ? r.result : []) {
      const o = objeto(fila);
      if (o) {
        filas.push(o);
      }
    }
  }
  return {
    filas,
    total: total ?? filas.length,
    truncado: paginas > MAXIMO_PAGINAS
  };
}

// --- Zonas --------------------------------------------------------------

export interface ZonaCloudflare {
  id: string;
  /** El dominio, por ejemplo `dealersolutions.com.mx`. */
  nombre: string;
  /** active, pending, initializing, moved... tal como lo dice Cloudflare. */
  estado: string;
  plan?: string;
  servidoresDeNombres: string[];
  pausada: boolean;
  /** La cuenta de Cloudflare a la que pertenece (para consultar el Registrar). */
  cuentaId?: string;
}

export async function zonas(
  config: ConfiguracionCloudflare
): Promise<ZonaCloudflare[]> {
  const { filas } = await pedirTodas(
    config,
    '/zones',
    POR_PAGINA_ZONAS,
    config.accountId ? { 'account.id': config.accountId } : {}
  );
  const salida: ZonaCloudflare[] = [];
  for (const z of filas) {
    const id = texto(z['id']);
    const nombre = texto(z['name'])?.toLowerCase();
    if (!id || !nombre) {
      continue;
    }
    const nameServers = z['name_servers'];
    salida.push({
      id,
      nombre,
      estado: texto(z['status']) ?? 'unknown',
      plan: texto(objeto(z['plan'])?.['name']),
      servidoresDeNombres: Array.isArray(nameServers)
        ? nameServers.map(texto).filter((n): n is string => n !== undefined)
        : [],
      pausada: z['paused'] === true,
      cuentaId: texto(objeto(z['account'])?.['id'])
    });
  }
  return salida.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// --- Registros DNS -------------------------------------------------------

export interface RegistroDns {
  id: string;
  /** El nombre completo (FQDN), por ejemplo `api.dealersolutions.com.mx`. */
  nombre: string;
  tipo: string;
  contenido: string;
  proxied: boolean;
  /** 1 significa "automatico" en Cloudflare. */
  ttl: number;
  comentario?: string;
  /** Solo MX y SRV. */
  prioridad?: number;
}

export interface RegistrosDeZona {
  registros: RegistroDns[];
  /** Cuantos registros dice Cloudflare que hay (puede superar a `registros`). */
  total: number;
  /** Hubo mas paginas de las que se leen (`MAXIMO_PAGINAS`). */
  truncado: boolean;
}

export async function registros(
  config: ConfiguracionCloudflare,
  zonaId: string
): Promise<RegistrosDeZona> {
  if (!/^[a-f0-9]{32}$/i.test(zonaId)) {
    throw new ErrorProveedor(
      'cloudflare',
      'El id de la zona no es válido.',
      400
    );
  }
  const { filas, total, truncado } = await pedirTodas(
    config,
    `/zones/${zonaId}/dns_records`,
    POR_PAGINA_REGISTROS
  );
  const salida: RegistroDns[] = [];
  for (const f of filas) {
    const id = texto(f['id']);
    const nombre = texto(f['name'])?.toLowerCase();
    const tipo = texto(f['type'])?.toUpperCase();
    if (!id || !nombre || !tipo) {
      continue;
    }
    const prioridad = Number(f['priority']);
    salida.push({
      id,
      nombre,
      tipo,
      contenido: typeof f['content'] === 'string' ? f['content'] : '',
      proxied: f['proxied'] === true,
      ttl: Number(f['ttl']) || 1,
      comentario: texto(f['comment']),
      prioridad:
        (tipo === 'MX' || tipo === 'SRV') &&
        f['priority'] !== undefined &&
        f['priority'] !== null &&
        Number.isFinite(prioridad)
          ? prioridad
          : undefined
    });
  }
  salida.sort(
    (a, b) => a.nombre.localeCompare(b.nombre) || a.tipo.localeCompare(b.tipo)
  );
  return { registros: salida, total, truncado };
}

// --- Cloudflare Registrar ------------------------------------------------

export interface DominioRegistrado {
  nombre: string;
  venceEn: string;
  autoRenovar: boolean;
}

/**
 * Los dominios registrados EN Cloudflare Registrar, con su vencimiento. Es
 * opcional: si el token no tiene ese permiso, la cuenta no usa Registrar o la
 * API no contesta, devuelve `[]` sin error y la fecha se captura a mano.
 * `cuentas` son las cuentas de las zonas, por si no se configuro
 * `CLOUDFLARE_ACCOUNT_ID`.
 */
export async function registradas(
  config: ConfiguracionCloudflare,
  cuentas: string[] = []
): Promise<DominioRegistrado[]> {
  const ids = [
    ...new Set(config.accountId ? [config.accountId] : cuentas)
  ].filter((id) => /^[a-f0-9]{32}$/i.test(id));
  const salida = new Map<string, DominioRegistrado>();
  for (const cuenta of ids) {
    try {
      const { filas } = await pedirTodas(
        config,
        `/accounts/${cuenta}/registrar/domains`,
        POR_PAGINA_ZONAS
      );
      for (const d of filas) {
        const nombre = texto(d['name'])?.toLowerCase();
        const vence = texto(d['expires_at']);
        if (nombre && vence && !Number.isNaN(Date.parse(vence))) {
          salida.set(nombre, {
            nombre,
            // Solo importa el dia: al mediodia UTC cae en el mismo dia en Mexico
            // (igual que las fechas que captura el portal).
            venceEn: `${new Date(vence).toISOString().slice(0, 10)}T12:00:00.000Z`,
            autoRenovar: d['auto_renew'] === true
          });
        }
      }
    } catch {
      // Sin permiso de Registrar (o sin Registrar): la fecha va a mano.
    }
  }
  return [...salida.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// --- Subdominios ---------------------------------------------------------

export interface Subdominio {
  /** El nombre sin la zona: `@` para el apex, `*` para el comodin. */
  host: string;
  /** El nombre completo, para abrirlo. */
  fqdn: string;
  registros: RegistroDns[];
  total: number;
  /** Algun A, AAAA o CNAME esta detras del proxy de Cloudflare. */
  proxied: boolean;
  /** Tiene A, AAAA o CNAME: es algo a lo que se puede entrar con el navegador. */
  web: boolean;
  /** Empieza con `_` (DMARC, DKIM, validaciones...): se ve, pero al final. */
  tecnico: boolean;
}

const ORDEN_TIPOS = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];

function pesoTipo(tipo: string): number {
  const i = ORDEN_TIPOS.indexOf(tipo);
  return i === -1 ? ORDEN_TIPOS.length : i;
}

/** El host de un nombre dentro de su zona: `api.zona.com` → `api`. */
export function hostDe(zonaNombre: string, nombre: string): string {
  const zona = zonaNombre.toLowerCase();
  const n = nombre.toLowerCase();
  if (n === zona) {
    return '@';
  }
  return n.endsWith(`.${zona}`) ? n.slice(0, -(zona.length + 1)) : n;
}

/**
 * Agrupa los registros por host. No oculta ninguno: los de validacion
 * (`_dmarc`, `_acme-challenge`...) salen como cualquier otro host, solo
 * marcados como tecnicos y al final.
 */
export function agruparSubdominios(
  zonaNombre: string,
  lista: RegistroDns[]
): Subdominio[] {
  const grupos = new Map<string, RegistroDns[]>();
  for (const registro of lista) {
    const host = hostDe(zonaNombre, registro.nombre);
    grupos.set(host, [...(grupos.get(host) ?? []), registro]);
  }
  const salida: Subdominio[] = [];
  for (const [host, registros] of grupos) {
    const ordenados = [...registros].sort(
      (a, b) =>
        pesoTipo(a.tipo) - pesoTipo(b.tipo) ||
        a.tipo.localeCompare(b.tipo) ||
        (a.prioridad ?? 0) - (b.prioridad ?? 0) ||
        a.contenido.localeCompare(b.contenido)
    );
    const web = ordenados.filter((r) =>
      ['A', 'AAAA', 'CNAME'].includes(r.tipo)
    );
    salida.push({
      host,
      fqdn: host === '@' ? zonaNombre.toLowerCase() : ordenados[0]!.nombre,
      registros: ordenados,
      total: ordenados.length,
      proxied: web.some((r) => r.proxied),
      web: web.length > 0,
      tecnico: host.split('.').some((parte) => parte.startsWith('_'))
    });
  }
  return salida.sort(
    (a, b) =>
      Number(a.tecnico) - Number(b.tecnico) ||
      Number(b.host === '@') - Number(a.host === '@') ||
      a.host.localeCompare(b.host)
  );
}
