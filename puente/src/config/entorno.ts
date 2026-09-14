/**
 * Configuracion del puente, leida del entorno.
 *
 * Todas las credenciales viven aqui y solo aqui: el navegador nunca las ve, y
 * el repositorio tampoco. Ver `.env.example` para la lista completa.
 *
 * Una conexion sin credencial no rompe el arranque: queda apagada, su ruta
 * responde 503 con el nombre de la variable que falta, y el portal lo muestra
 * en Ajustes. Asi se puede conectar de una en una.
 */

export interface ConfiguracionAnthropic {
  adminKey: string;
  /** Cuenta del portal a la que pertenecen estos datos. */
  accountId: string;
  /** Asientos contratados de Claude Code, que la API de uso no reporta. */
  asientosContratados?: number;
  /** Costo mensual de esos asientos, para la tarjeta de licencia. */
  costoAsientos?: number;
  renuevaEn?: string;
}

export interface ConfiguracionCursor {
  apiKey: string;
  accountId: string;
  asientosContratados?: number;
  costoMensual?: number;
  solicitudesIncluidas?: number;
  renuevaEn?: string;
}

export interface ConfiguracionFigma {
  token: string;
  teamId: string;
  accountId: string;
  /**
   * Figma no publica facturacion ni asientos contratados por API, asi que estos
   * tres se capturan aqui a mano y la licencia sale marcada como manual.
   */
  asientosContratados?: number;
  costoMensual?: number;
  renuevaEn?: string;
}

export interface ConfiguracionVercel {
  token: string;
  accountId: string;
  teamId?: string;
  /** Cuantos despliegues traer por consulta. */
  limite: number;
  /** Pagina de estado del proveedor, en formato Statuspage. */
  urlEstado: string;
  presupuestoMensual?: number;
  gastoMensual?: number;
  renuevaEn?: string;
}

export interface DestinoMonitoreo {
  id: string;
  name: string;
  url: string;
  kind: 'sitio' | 'api' | 'servicio' | 'proceso';
  environment: 'produccion' | 'pruebas' | 'desarrollo';
}

export interface ConfiguracionMonitoreo {
  accountId: string;
  destinos: DestinoMonitoreo[];
}

export interface ConfiguracionOdoo {
  url: string;
  db: string;
  usuario: string;
  apiKey: string;
  accountId: string;
}

/**
 * Quien tiene permiso de mandarnos datos.
 *
 * El token identifica al emisor: el origen NO viaja en el cuerpo, para que
 * nadie pueda hacerse pasar por otro cambiando un campo del JSON.
 */
export interface ClienteIngesta {
  /** Nombre corto del emisor. Aparece en la ruta de lectura. */
  nombre: string;
  token: string;
  /** Que tipos de envio puede mandar. */
  tipos: string[];
  /** Cuenta del portal con la que se marcan sus datos. */
  accountId: string;
  /**
   * Cada cuantos segundos se espera un envio. Pasado ese tiempo el dato se
   * reporta como vencido. 0 significa que nunca vence.
   */
  vigenciaSegundos: number;
}

export interface ConfiguracionGithub {
  token: string;
  accountId: string;
  /** Repositorios a vigilar, como "propietario/repositorio". */
  repos: string[];
  /** Cuantos pull requests abiertos traer por repositorio. */
  limitePullRequests: number;
}

export interface Configuracion {
  puerto: number;
  /** Origenes que pueden llamar al puente. Vacio significa mismo origen. */
  origenesPermitidos: string[];
  /** Segundos que vive cada respuesta en cache, por tipo de dato. */
  cacheSegundos: {
    licencias: number;
    despliegues: number;
    estadoPlataforma: number;
    monitoreo: number;
    crm: number;
    repos: number;
  };
  anthropic?: ConfiguracionAnthropic;
  cursor?: ConfiguracionCursor;
  figma?: ConfiguracionFigma;
  vercel?: ConfiguracionVercel;
  monitoreo?: ConfiguracionMonitoreo;
  odoo?: ConfiguracionOdoo;
  github?: ConfiguracionGithub;
  /** Emisores autorizados a mandar datos al puente. */
  clientesIngesta: ClienteIngesta[];
  /** Donde se guarda lo recibido. Vacio lo deja solo en memoria. */
  directorioIngesta?: string;
  /** Tope del cuerpo de un envio, en bytes. */
  maximoCuerpoBytes: number;
}

function texto(nombre: string): string | undefined {
  const valor = process.env[nombre];
  return valor && valor.trim() !== '' ? valor.trim() : undefined;
}

function numero(nombre: string): number | undefined {
  const valor = texto(nombre);
  if (valor === undefined) {
    return undefined;
  }
  const parseado = Number(valor);
  return Number.isFinite(parseado) ? parseado : undefined;
}

function numeroCon(nombre: string, porDefecto: number): number {
  return numero(nombre) ?? porDefecto;
}

function lista(nombre: string): string[] {
  const valor = texto(nombre);
  return valor
    ? valor
        .split(',')
        .map((parte) => parte.trim())
        .filter(Boolean)
    : [];
}

/**
 * Los destinos de monitoreo van en una variable con formato
 * `id|nombre|url|tipo|entorno`, separados por punto y coma.
 *
 * Es texto plano y no JSON porque esto se escribe a mano en el panel del
 * servidor, donde un JSON de varias lineas es incomodo de pegar.
 */
function destinosMonitoreo(): DestinoMonitoreo[] {
  const crudo = texto('MONITOREO_DESTINOS');
  if (!crudo) {
    return [];
  }
  return crudo
    .split(';')
    .map((entrada) => entrada.split('|').map((parte) => parte.trim()))
    .filter(
      (partes) => partes.length >= 3 && partes[0] && partes[1] && partes[2]
    )
    .map((partes) => ({
      id: partes[0] as string,
      name: partes[1] as string,
      url: partes[2] as string,
      kind: (partes[3] as DestinoMonitoreo['kind']) || 'sitio',
      environment:
        (partes[4] as DestinoMonitoreo['environment']) || 'produccion'
    }));
}

/**
 * Los clientes de ingesta van en una variable con formato
 * `nombre|token|tipos|cuenta|vigencia`, separados por punto y coma.
 *
 * Ejemplo:
 *   ops|tok_abc|pendientes,crm|ops|900;calendario|tok_def|juntas|correo-trabajo|3600
 *
 * Es texto plano y no JSON por lo mismo que los destinos de monitoreo: esto se
 * pega a mano en el panel del servidor.
 */
function clientesIngesta(): ClienteIngesta[] {
  const crudo = texto('INGESTA_CLIENTES');
  if (!crudo) {
    return [];
  }
  return crudo
    .split(';')
    .map((entrada) => entrada.split('|').map((parte) => parte.trim()))
    .filter(
      (partes) => partes.length >= 3 && partes[0] && partes[1] && partes[2]
    )
    .map((partes) => ({
      nombre: partes[0] as string,
      token: partes[1] as string,
      tipos: (partes[2] as string)
        .split(',')
        .map((tipo) => tipo.trim())
        .filter(Boolean),
      accountId: partes[3] || (partes[0] as string),
      vigenciaSegundos: Number(partes[4] ?? '0') || 0
    }));
}

export function leerConfiguracion(): Configuracion {
  const anthropicKey = texto('ANTHROPIC_ADMIN_KEY');
  const cursorKey = texto('CURSOR_API_KEY');
  const figmaToken = texto('FIGMA_TOKEN');
  const figmaTeam = texto('FIGMA_TEAM_ID');
  const vercelToken = texto('VERCEL_TOKEN');
  const odooUrl = texto('ODOO_URL');
  const githubToken = texto('GITHUB_TOKEN');
  const destinos = destinosMonitoreo();

  return {
    puerto: numeroCon('PUENTE_PUERTO', 8787),
    origenesPermitidos: lista('PUENTE_ORIGENES'),
    cacheSegundos: {
      // Los datos de uso de Claude tardan hasta cinco minutos en aparecer y no
      // conviene sondear mas de una vez por minuto: refrescar mas seguido no
      // trae nada nuevo y si acerca al limite.
      licencias: numeroCon('CACHE_LICENCIAS_SEGUNDOS', 300),
      despliegues: numeroCon('CACHE_DESPLIEGUES_SEGUNDOS', 30),
      estadoPlataforma: numeroCon('CACHE_ESTADO_SEGUNDOS', 60),
      monitoreo: numeroCon('CACHE_MONITOREO_SEGUNDOS', 60),
      crm: numeroCon('CACHE_CRM_SEGUNDOS', 120),
      repos: numeroCon('CACHE_REPOS_SEGUNDOS', 120)
    },
    anthropic: anthropicKey
      ? {
          adminKey: anthropicKey,
          accountId: texto('ANTHROPIC_ACCOUNT_ID') ?? 'claude',
          asientosContratados: numero('ANTHROPIC_ASIENTOS'),
          costoAsientos: numero('ANTHROPIC_COSTO_ASIENTOS'),
          renuevaEn: texto('ANTHROPIC_RENUEVA_EN')
        }
      : undefined,
    cursor: cursorKey
      ? {
          apiKey: cursorKey,
          accountId: texto('CURSOR_ACCOUNT_ID') ?? 'cursor',
          asientosContratados: numero('CURSOR_ASIENTOS'),
          costoMensual: numero('CURSOR_COSTO_MENSUAL'),
          solicitudesIncluidas: numero('CURSOR_SOLICITUDES_INCLUIDAS'),
          renuevaEn: texto('CURSOR_RENUEVA_EN')
        }
      : undefined,
    figma:
      figmaToken && figmaTeam
        ? {
            token: figmaToken,
            teamId: figmaTeam,
            accountId: texto('FIGMA_ACCOUNT_ID') ?? 'figma',
            asientosContratados: numero('FIGMA_ASIENTOS'),
            costoMensual: numero('FIGMA_COSTO_MENSUAL'),
            renuevaEn: texto('FIGMA_RENUEVA_EN')
          }
        : undefined,
    vercel: vercelToken
      ? {
          token: vercelToken,
          accountId: texto('VERCEL_ACCOUNT_ID') ?? 'vercel',
          teamId: texto('VERCEL_TEAM_ID'),
          limite: numeroCon('VERCEL_LIMITE', 20),
          urlEstado:
            texto('VERCEL_URL_ESTADO') ??
            'https://www.vercel-status.com/api/v2/status.json',
          presupuestoMensual: numero('VERCEL_PRESUPUESTO'),
          gastoMensual: numero('VERCEL_GASTO'),
          renuevaEn: texto('VERCEL_RENUEVA_EN')
        }
      : undefined,
    monitoreo:
      destinos.length > 0
        ? {
            accountId: texto('MONITOREO_ACCOUNT_ID') ?? 'plataformas',
            destinos
          }
        : undefined,
    odoo:
      odooUrl &&
      texto('ODOO_DB') &&
      texto('ODOO_USUARIO') &&
      texto('ODOO_API_KEY')
        ? {
            url: odooUrl.replace(/\/+$/, ''),
            db: texto('ODOO_DB') as string,
            usuario: texto('ODOO_USUARIO') as string,
            apiKey: texto('ODOO_API_KEY') as string,
            accountId: texto('ODOO_ACCOUNT_ID') ?? 'itech'
          }
        : undefined,
    github: githubToken
      ? {
          token: githubToken,
          accountId: texto('GITHUB_ACCOUNT_ID') ?? 'github',
          repos: lista('GITHUB_REPOS'),
          limitePullRequests: numeroCon('GITHUB_LIMITE_PR', 10)
        }
      : undefined,
    clientesIngesta: clientesIngesta(),
    directorioIngesta: texto('INGESTA_DIRECTORIO') ?? 'datos/ingesta',
    maximoCuerpoBytes: numeroCon('INGESTA_MAXIMO_KB', 512) * 1024
  };
}
