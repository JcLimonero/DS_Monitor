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

/**
 * Un buzon de correo del que se sacan juntas, pendientes y licencias.
 *
 * `proveedor` decide como se entra: `google` e `imap` van por IMAP con
 * contraseña (de aplicacion en Gmail e iCloud, del buzon en Neubox);
 * `microsoft` ya no acepta IMAP con contraseña y necesita OAuth, que todavia
 * no esta construido, asi que su ruta responde 501 explicandolo.
 */
export interface ConfiguracionCorreo {
  id: string;
  proveedor: 'google' | 'microsoft' | 'imap';
  host: string;
  puerto: number;
  usuario: string;
  contrasena: string;
  /** Cuenta del portal con la que se marcan sus datos. */
  accountId: string;
  /** Buzones IMAP a leer. Por omision solo INBOX. */
  buzones: string[];
  /** Cuantos dias hacia atras se leen los encabezados. */
  diasAtras: number;
  /**
   * Para Microsoft: la aplicacion registrada en Entra ID con la que el puente
   * entra por Microsoft Graph, y el refresh token que quedo al conectar la
   * cuenta desde Ajustes. Sin refresh token la cuenta esta registrada pero no
   * conectada.
   */
  microsoft?: ConfiguracionMicrosoft;
}

export interface ConfiguracionMicrosoft {
  /** `common` para aceptar cuentas de trabajo y personales. */
  tenant: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  /** Con que cuenta se completo el consentimiento, para mostrarlo. */
  conectadaComo?: string;
}

/**
 * Acceso al portal con codigo por correo. Los correos de la lista son los
 * unicos que pueden entrar; el codigo se manda por EmailJS con el servicio y
 * la plantilla que ya existen.
 */
export interface ConfiguracionAcceso {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey: string;
  correos: string[];
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
    correo: number;
  };
  anthropic?: ConfiguracionAnthropic;
  cursor?: ConfiguracionCursor;
  figma?: ConfiguracionFigma;
  vercel?: ConfiguracionVercel;
  monitoreo?: ConfiguracionMonitoreo;
  odoo?: ConfiguracionOdoo;
  github?: ConfiguracionGithub;
  /** Buzones de correo configurados por entorno. Vacio si no hay ninguno. */
  correos: ConfiguracionCorreo[];
  /** Donde se guardan las credenciales de buzones capturadas desde Ajustes. */
  directorioCorreo: string;
  /** Donde se guardan las variables de integraciones capturadas desde Ajustes. */
  directorioIntegraciones: string;
  /** Cuantos dias hacia atras se leen los buzones. */
  correoDiasAtras: number;
  /**
   * Token que el portal manda para editar buzones y probar conexiones. Sin el,
   * esas rutas responden 503 y el resto del puente sigue igual.
   */
  adminToken?: string;
  /** Con esto configurado, el puente exige sesion (codigo por correo). */
  acceso?: ConfiguracionAcceso;
  /** Donde viven el equipo, los dominios y las sesiones. */
  directorioDatos: string;
  /**
   * URL con la que se llega al puente desde afuera, para armar la URL de
   * regreso de OAuth. Por omision, localhost con el puerto y el prefijo.
   */
  urlPublica: string;
  /** Emisores autorizados a mandar datos al puente. */
  clientesIngesta: ClienteIngesta[];
  /** Donde se guarda lo recibido. Vacio lo deja solo en memoria. */
  directorioIngesta?: string;
  /** Tope del cuerpo de un envio, en bytes. */
  maximoCuerpoBytes: number;
}

/**
 * De donde se leen las variables. Por omision el entorno del proceso; el
 * puente le pone encima lo capturado desde Ajustes, para que una credencial
 * guardada desde el portal se lea exactamente igual que una del .env.
 */
let variables: Record<string, string | undefined> = process.env;

function texto(nombre: string): string | undefined {
  const valor = variables[nombre];
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

/**
 * Los buzones van en `CORREO_CUENTAS` con formato
 * `id|proveedor|host|puerto|usuario|buzones`, separados por punto y coma, y la
 * contraseña de cada uno en su propia variable `CORREO_CONTRASENA_<ID>` (el id
 * en mayusculas, con guiones convertidos a guion bajo). Van separadas a
 * proposito: una contraseña puede llevar `|` o `;`, y en el panel del servidor
 * cada secreto se captura por su lado.
 *
 * Ejemplo:
 *   CORREO_CUENTAS=correo-gmail|google|imap.gmail.com|993|alguien@gmail.com|INBOX
 *   CORREO_CONTRASENA_CORREO_GMAIL=abcd efgh ijkl mnop
 *
 * Un buzon sin contraseña queda apagado y su ruta dice que variable falta.
 */
function cuentasCorreo(): ConfiguracionCorreo[] {
  const crudo = texto('CORREO_CUENTAS');
  if (!crudo) {
    return [];
  }
  const diasAtras = numeroCon('CORREO_DIAS_ATRAS', 400);
  return crudo
    .split(';')
    .map((entrada) => entrada.split('|').map((parte) => parte.trim()))
    .filter(
      (partes) =>
        partes.length >= 5 && partes[0] && partes[1] && partes[2] && partes[4]
    )
    .map((partes) => {
      const id = partes[0] as string;
      const proveedor = partes[1] as ConfiguracionCorreo['proveedor'];
      return {
        id,
        proveedor: ['google', 'microsoft', 'imap'].includes(proveedor)
          ? proveedor
          : 'imap',
        host: partes[2] as string,
        puerto: Number(partes[3]) || 993,
        usuario: partes[4] as string,
        contrasena: texto(variableContrasena(id)) ?? '',
        accountId: id,
        buzones: (partes[5] ?? 'INBOX')
          .split(',')
          .map((buzon) => buzon.trim())
          .filter(Boolean),
        diasAtras
      };
    });
}

/** `correo-gmail` -> `CORREO_CONTRASENA_CORREO_GMAIL`. */
export function variableContrasena(id: string): string {
  return `CORREO_CONTRASENA_${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

export function leerConfiguracion(
  fuente: Record<string, string | undefined> = process.env
): Configuracion {
  variables = fuente;
  try {
    return leer();
  } finally {
    variables = process.env;
  }
}

function leer(): Configuracion {
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
      repos: numeroCon('CACHE_REPOS_SEGUNDOS', 120),
      // Leer un buzon completo por IMAP es lento y los proveedores limitan las
      // conexiones simultaneas, asi que se lee cada tanto y se sirve de aqui.
      correo: numeroCon('CACHE_CORREO_SEGUNDOS', 900)
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
    correos: cuentasCorreo(),
    directorioCorreo: texto('CORREO_DIRECTORIO') ?? 'datos/correo',
    directorioIntegraciones:
      texto('INTEGRACIONES_DIRECTORIO') ?? 'datos/integraciones',
    correoDiasAtras: numeroCon('CORREO_DIAS_ATRAS', 400),
    adminToken: texto('PUENTE_ADMIN_TOKEN'),
    acceso:
      texto('EMAILJS_SERVICE_ID') &&
      texto('EMAILJS_TEMPLATE_ID') &&
      texto('EMAILJS_PUBLIC_KEY') &&
      texto('EMAILJS_PRIVATE_KEY') &&
      lista('ACCESO_CORREOS').length > 0
        ? {
            serviceId: texto('EMAILJS_SERVICE_ID') as string,
            templateId: texto('EMAILJS_TEMPLATE_ID') as string,
            publicKey: texto('EMAILJS_PUBLIC_KEY') as string,
            privateKey: texto('EMAILJS_PRIVATE_KEY') as string,
            correos: lista('ACCESO_CORREOS').map((c) => c.toLowerCase())
          }
        : undefined,
    directorioDatos: texto('DATOS_DIRECTORIO') ?? 'datos',
    urlPublica:
      texto('PUENTE_URL_PUBLICA')?.replace(/\/+$/, '') ??
      `http://localhost:${numeroCon('PUENTE_PUERTO', 8787)}${texto('PUENTE_PREFIJO') ?? ''}`,
    clientesIngesta: clientesIngesta(),
    directorioIngesta: texto('INGESTA_DIRECTORIO') ?? 'datos/ingesta',
    maximoCuerpoBytes: numeroCon('INGESTA_MAXIMO_KB', 512) * 1024
  };
}
