import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  variableContrasena,
  type Configuracion,
  type ConfiguracionCorreo
} from '../config/entorno.js';
import { join } from 'node:path';
import { Acceso, type Sesion } from '../acceso/acceso.js';
import { AlmacenCorreo } from '../correo/almacen-correo.js';
import { AlmacenJson } from '../datos/almacen-json.js';
import {
  COLECCIONES,
  PersistenciaArchivos,
  type Persistencia
} from '../datos/persistencia.js';
import { AlmacenTabla } from '../datos/almacen-tabla.js';
import {
  TABLA_ANOTACIONES,
  TABLA_AVISOS,
  TABLA_DOMINIOS,
  TABLA_EJECUCIONES,
  TABLA_EMISORES,
  TABLA_EQUIPO,
  TABLA_LIGAS,
  TABLA_PERSONALES,
  TABLA_REGISTRO_CORREO,
  TABLA_SESIONES,
  type Aviso
} from '../datos/tablas.js';
import {
  dominiosComoLicencias,
  validarDominio,
  type Dominio
} from '../datos/dominios.js';
import type {
  LicenseUsage,
  Meeting,
  MonitorTarget,
  Person,
  TaskItem,
  TaskStatus
} from '../nucleo/contrato.js';

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  bloqueado: 'Bloqueado',
  hecho: 'Hecho'
};
import type { Fuentes } from '../ia/tablero.js';
import {
  anotar,
  conEvento,
  describirCambios,
  limpiarCambios,
  type Anotacion,
  type Anotaciones,
  type CambiosPendiente
} from '../pendientes/anotaciones.js';
import { registrar, type Registro } from '../pendientes/registro.js';
import { homologarPendientes, idsDelGrupo } from '../pendientes/homologar.js';
import { conRemitente } from '../pendientes/remitente.js';
import { enviarPorEmailJs } from '../acceso/acceso.js';
import type {
  ClienteIngesta,
  ConfiguracionFireflies,
  ConfiguracionOdoo,
  ConfiguracionVercel
} from '../config/entorno.js';
import {
  transcripcion,
  transcripcionesRecientes
} from '../proveedores/fireflies.js';
import { pendientesDeTranscripcion } from '../ia/juntas-fireflies.js';
import {
  bajarArchivo,
  leerUpdate,
  responder
} from '../proveedores/telegram.js';
import { transcribir } from '../ia/transcribir.js';
import { interpretarDictado } from '../ia/dictado.js';
import {
  AlmacenIntegraciones,
  Configurador
} from '../integraciones/almacen-integraciones.js';
import { INTEGRACIONES, integracion } from '../integraciones/catalogo.js';
import { ClienteImap } from '../proveedores/imap.js';
import {
  canjearCodigoGoogle,
  olvidarAccesoGoogle,
  quienSoyGoogle,
  tokenDeAccesoGoogle,
  urlDeAutorizacionGoogle
} from '../proveedores/google.js';
import {
  canjearCodigo,
  leerCorreoMicrosoft,
  crearEventoMicrosoft,
  type NuevaJunta,
  olvidarAcceso,
  quienSoy,
  urlDeAutorizacion
} from '../proveedores/microsoft.js';
import { AlmacenIngesta } from '../ingesta/almacen.js';
import {
  registrarRutasIngesta,
  TIPOS_EMISOR,
  servirRecibido
} from '../ingesta/rutas-ingesta.js';
import type { TipoIngesta } from '../ingesta/modelos.js';
import {
  avisosPendientes,
  listarEjecuciones,
  registrarEjecucion,
  type AvisosEjecuciones,
  type Ejecuciones
} from '../ingesta/ejecuciones.js';
import { avisosDeSitios, type SitiosAvisados } from '../nucleo/vigilancia.js';
import { conPrioridadPersonal } from '../pendientes/prioridad.js';
import { semanaIso } from '../ia/repos.js';
import { armarTablero } from '../ia/tablero.js';
import {
  TEXTO_AYUDA,
  interpretarComando,
  textoHoy,
  textoPendientes,
  textoServicios
} from '../nucleo/comandos-telegram.js';
import { Cache } from '../nucleo/cache.js';
import { ErrorConfiguracion, ErrorPuente } from '../nucleo/errores.js';
import { licenciasAnthropic } from '../proveedores/anthropic.js';
import { consumoOpenRouter } from '../proveedores/openrouter.js';
import { leerCorreo, type DatosCorreo } from '../proveedores/correo.js';
import {
  clasificarCorreos,
  empresaDeCuenta,
  pendienteDeClasificacion,
  type Clasificacion
} from '../proveedores/ia.js';
import { licenciasCursor } from '../proveedores/cursor.js';
import { licenciasFigma } from '../proveedores/figma.js';
import { reposGithub } from '../proveedores/github.js';
import { actividadesComoPendientes, crmOdoo } from '../proveedores/odoo.js';
import {
  destinosMonitoreados,
  type HistorialMonitoreo
} from '../proveedores/monitoreo.js';
import {
  desplieguesVercel,
  estadoPlataformaVercel,
  licenciasVercel
} from '../proveedores/vercel.js';
import { Redireccion, Router, type Contexto } from './router.js';
import { Push, type ColaPush, type Suscripcion } from '../push/push.js';
import { USOS_POR_OMISION, type UsoIa, type UsosIa } from '../ia/usos.js';
import { establecerBitacora, type EntradaBitacora } from '../ia/modelo.js';
import {
  aplicarAprendido,
  aprender,
  pistasParaModelo,
  type Aprendizajes
} from '../pendientes/aprendido.js';
import type { ClavesVapid } from '../push/vapid.js';
import {
  registrarRutasIa,
  type DatosIa,
  type Programable,
  type ServiciosIa
} from './rutas-ia.js';

/**
 * Las rutas del contrato que consume el portal.
 *
 * Cada conexion del portal tiene una ruta base (`/licencias/anthropic`,
 * `/vercel`...) y cuelga de ella el recurso que pide su adaptador. Lo que se
 * publica aqui es exactamente lo que documenta
 * `portal/src/app/core/sources/gateway/gateway.sources.ts`.
 */

/** Conexiones que el portal puede pedir y la variable que las enciende. */
const CREDENCIAL_DE: Record<string, string> = {
  anthropic: 'ANTHROPIC_ADMIN_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  cursor: 'CURSOR_API_KEY',
  figma: 'FIGMA_TOKEN y FIGMA_TEAM_ID',
  vercel: 'VERCEL_TOKEN',
  monitoreo: 'MONITOREO_DESTINOS',
  github: 'GITHUB_TOKEN',
  odoo: 'ODOO_URL, ODOO_DB, ODOO_USUARIO y ODOO_API_KEY',
  ops: 'un emisor con tipo pendientes (Pendientes → API)'
};

function exigir<T>(valor: T | undefined, conexion: string): T {
  if (valor === undefined) {
    // Un 503 con el nombre de la variable es lo que la pantalla de Ajustes del
    // portal muestra, asi que el mensaje tiene que bastar para actuar.
    throw new ErrorConfiguracion(
      `La conexión "${conexion}" no está configurada: falta ${CREDENCIAL_DE[conexion] ?? 'su credencial'} en el entorno del puente.`
    );
  }
  return valor;
}

export interface Estado {
  conexion: string;
  configurada: boolean;
  /** Qué alimenta esta conexión en el portal. */
  provee: string[];
  faltante?: string;
}

/** Qué conexiones están encendidas. Lo consume `/salud`. */
export function estadoDeConexiones(
  config: Configuracion,
  almacenCorreo = new AlmacenCorreo(
    new PersistenciaArchivos({ correo: config.directorioCorreo })
  ),
  hayEmisoresOps: () => boolean = () => false
): Estado[] {
  const filas: [string, boolean, string[]][] = [
    ['anthropic', config.anthropic !== undefined, ['licenses']],
    ['openrouter', config.ia !== undefined, ['licenses']],
    ['cursor', config.cursor !== undefined, ['licenses']],
    ['figma', config.figma !== undefined, ['licenses']],
    ['vercel', config.vercel !== undefined, ['deployments', 'licenses']],
    ['monitoreo', config.monitoreo !== undefined, ['monitors']],
    ['odoo', config.odoo !== undefined, ['crm']],
    ['github', config.github !== undefined, ['repos']],
    [
      'ops',
      config.clientesIngesta.some(
        (c) => c.tipos.includes('pendientes') && !c.nombre.startsWith('correo-')
      ) || hayEmisoresOps(),
      ['tasks']
    ]
  ];

  const fijas: Estado[] = filas.map(([conexion, configurada, provee]) => ({
    conexion,
    configurada,
    provee,
    faltante: configurada ? undefined : CREDENCIAL_DE[conexion]
  }));

  // Cada buzon es una conexion aparte, para que se enciendan de uno en uno.
  const correos: Estado[] = buzones_(config, almacenCorreo).map((correo) => ({
    conexion: correo.id,
    configurada: correoListo(correo, config),
    provee: ['meetings', 'tasks', 'licenses'],
    faltante: correoListo(correo, config) ? undefined : faltanteDe(correo)
  }));

  return [...fijas, ...correos];
}

/** Los buzones del entorno con lo capturado desde Ajustes encima. */
function buzones_(
  config: Configuracion,
  almacenCorreo: AlmacenCorreo
): ConfiguracionCorreo[] {
  const ids = new Set([
    ...config.correos.map((c) => c.id),
    ...almacenCorreo.ids()
  ]);
  const porId = new Map(config.correos.map((c) => [c.id, c]));
  return [...ids]
    .map((id) =>
      almacenCorreo.efectiva(
        id,
        porId.get(id),
        config.correoDiasAtras,
        config.microsoftApp,
        config.googleApp
      )
    )
    .filter((c): c is ConfiguracionCorreo => c !== undefined);
}

/** Los almacenes de datos propios: equipo, dominios y sesiones. */
export interface Datos {
  equipo: AlmacenJson<Person[]>;
  dominios: AlmacenJson<Dominio[]>;
  sesiones: AlmacenJson<Sesion[]>;
  /** Los pendientes personales: los que uno se apunta en el portal. */
  personales: AlmacenJson<TaskItem[]>;
  /** Emisores de la API de ingesta creados desde la aplicacion. */
  emisores: AlmacenJson<ClienteIngesta[]>;
  /** La ultima corrida de cada integracion, por emisor/integracion. */
  ejecuciones: AlmacenJson<Ejecuciones>;
  /** Comentarios, hecho y asignacion por pendiente, venga de donde venga. */
  anotaciones: AlmacenJson<Anotaciones>;
  /** Pendientes detectados en el correo, registrados por cuenta. */
  registroCorreo: AlmacenJson<Registro>;
  /** Lo que la IA ya dijo de cada correo, para no preguntarle dos veces. */
  iaCorreo: AlmacenJson<Record<string, Clasificacion>>;
  /** Lo demas que la IA genera y se guarda para no repetir la llamada. */
  iaResumen: DatosIa['iaResumen'];
  iaAlertas: DatosIa['iaAlertas'];
  costosHistorial: DatosIa['costosHistorial'];
  iaAcuerdos: DatosIa['iaAcuerdos'];
  iaCrm: DatosIa['iaCrm'];
  iaDiagnosticos: DatosIa['iaDiagnosticos'];
  iaRepos: DatosIa['iaRepos'];
  iaSemana: DatosIa['iaSemana'];
  iaPendientes: DatosIa['iaPendientes'];
  /** Avisos push: llaves VAPID, dispositivos suscritos, cola y ya avisados. */
  pushClaves: AlmacenJson<ClavesVapid | null>;
  pushSuscripciones: AlmacenJson<Suscripcion[]>;
  pushCola: AlmacenJson<ColaPush>;
  pushAvisados: AlmacenJson<Record<string, string>>;
  /** Por integracion, que problema ya se aviso por Telegram. */
  ejecucionesAvisadas: AlmacenJson<AvisosEjecuciones>;
  /** Sitios monitoreados que ya se avisaron como caidos por Telegram. */
  sitiosAvisados: AlmacenJson<SitiosAvisados>;
  /** Revisiones de cada sitio: 24 h tal cual y 30 dias por conteo diario. */
  monitoreoHistorial: AlmacenJson<HistorialMonitoreo>;
  /** Que avisos semanales ya salieron (semana ISO). */
  avisosSemanales: AlmacenJson<{ sinAsignar?: string }>;
  /** Donde se permite usar el modelo (Integraciones → IA). */
  iaUsos: AlmacenJson<UsosIa>;
  /** Bitacora de llamadas al modelo. */
  iaBitacora: AlmacenJson<EntradaBitacora[]>;
  /** Lo aprendido de las correcciones a mano, por remitente. */
  aprendido: AlmacenJson<Aprendizajes>;
  /** Ligas "mis pendientes": token → persona y hasta cuando sirve. */
  /**
   * Ligas personales del equipo: token → persona y vencimiento. Con `tarea`,
   * la liga solo enseña ese pendiente (la que va en el correo de asignacion).
   */
  ligasEquipo: AlmacenJson<
    Record<string, { persona: string; vence: string; tarea?: string }>
  >;
  /** Lo que el equipo hizo sobre sus pendientes, para avisar en el monitor. */
  avisos: AlmacenJson<Aviso[]>;
  /** Ultimo dia en que se pidio estatus, para no repetir. */
  estatusPedido: AlmacenJson<{ dia?: string }>;
  /** Que dias y a que hora se pide estatus (0 = domingo … 6 = sabado). */
  estatusConfig: AlmacenJson<{ dias: number[]; hora: number }>;
  /** Transcripciones de Fireflies ya convertidas en pendientes. */
  firefliesProcesadas: AlmacenJson<
    Record<string, { en: string; titulo: string; pendientes: number }>
  >;
}

/** Lee todos los almacenes (una sola lectura de la coleccion); al arrancar. */
export async function cargarDatos(
  datos: Datos,
  persistencia: Persistencia
): Promise<void> {
  const todos = await persistencia.leerColeccion('datos');
  for (const almacen of Object.values(datos)) {
    if (almacen instanceof AlmacenTabla) {
      // Tabla propia: se lee de la tabla (y migra el documento si esta vacia).
      await almacen.cargar();
    } else {
      (almacen as AlmacenJson<unknown>).cargarDe(todos);
    }
  }
}

export function abrirDatos(persistencia: Persistencia): Datos {
  return {
    equipo: new AlmacenTabla<Person[]>(persistencia, TABLA_EQUIPO, []),
    dominios: new AlmacenTabla<Dominio[]>(persistencia, TABLA_DOMINIOS, []),
    sesiones: new AlmacenTabla<Sesion[]>(persistencia, TABLA_SESIONES, []),
    personales: new AlmacenTabla<TaskItem[]>(
      persistencia,
      TABLA_PERSONALES,
      []
    ),
    emisores: new AlmacenTabla<ClienteIngesta[]>(
      persistencia,
      TABLA_EMISORES,
      []
    ),
    ejecuciones: new AlmacenTabla<Ejecuciones>(
      persistencia,
      TABLA_EJECUCIONES,
      {}
    ),
    anotaciones: new AlmacenTabla<Anotaciones>(
      persistencia,
      TABLA_ANOTACIONES,
      {}
    ),
    registroCorreo: new AlmacenTabla<Registro>(
      persistencia,
      TABLA_REGISTRO_CORREO,
      {}
    ),
    iaCorreo: new AlmacenJson<Record<string, Clasificacion>>(
      persistencia,
      'ia-correo',
      {}
    ),
    iaResumen: new AlmacenJson(persistencia, 'ia-resumen', null),
    iaAlertas: new AlmacenJson(persistencia, 'ia-alertas', {}),
    costosHistorial: new AlmacenJson(persistencia, 'licencias-historial', {}),
    iaAcuerdos: new AlmacenJson(persistencia, 'ia-acuerdos', {}),
    iaCrm: new AlmacenJson(persistencia, 'ia-crm', {}),
    iaDiagnosticos: new AlmacenJson(persistencia, 'ia-diagnosticos', {}),
    iaRepos: new AlmacenJson(persistencia, 'ia-repos', null),
    iaSemana: new AlmacenJson(persistencia, 'ia-semana', {}),
    iaPendientes: new AlmacenJson(persistencia, 'ia-pendientes', {}),
    pushClaves: new AlmacenJson(persistencia, 'push-claves', null),
    pushSuscripciones: new AlmacenJson(persistencia, 'push-suscripciones', []),
    pushCola: new AlmacenJson(persistencia, 'push-cola', {}),
    pushAvisados: new AlmacenJson(persistencia, 'push-avisados', {}),
    ejecucionesAvisadas: new AlmacenJson<AvisosEjecuciones>(
      persistencia,
      'ejecuciones-avisadas',
      {}
    ),
    sitiosAvisados: new AlmacenJson<SitiosAvisados>(
      persistencia,
      'sitios-avisados',
      {}
    ),
    monitoreoHistorial: new AlmacenJson<HistorialMonitoreo>(
      persistencia,
      'monitoreo-historial',
      {}
    ),
    avisosSemanales: new AlmacenJson<{ sinAsignar?: string }>(
      persistencia,
      'avisos-semanales',
      {}
    ),
    iaBitacora: new AlmacenJson<EntradaBitacora[]>(
      persistencia,
      'ia-bitacora',
      []
    ),
    aprendido: new AlmacenJson<Aprendizajes>(persistencia, 'aprendido', {}),
    iaUsos: new AlmacenJson<UsosIa>(persistencia, 'ia-usos', USOS_POR_OMISION),
    ligasEquipo: new AlmacenTabla(persistencia, TABLA_LIGAS, {}),
    avisos: new AlmacenTabla<Aviso[]>(persistencia, TABLA_AVISOS, []),
    estatusPedido: new AlmacenJson(persistencia, 'estatus-pedido', {}),
    // De inicio martes y jueves a las 9; se cambia desde Equipo → Configuración.
    estatusConfig: new AlmacenJson(persistencia, 'estatus-config', {
      dias: [2, 4],
      hora: 9
    }),
    firefliesProcesadas: new AlmacenJson(
      persistencia,
      'fireflies-procesadas',
      {}
    )
  };
}

/** Como se va a leer un buzon, en orden de preferencia. */
export type MetodoCorreo = 'graph' | 'imap' | 'envio' | 'ninguno';

export function metodoDe(
  correo: ConfiguracionCorreo,
  config: Configuracion
): MetodoCorreo {
  if (correo.proveedor === 'microsoft' && correo.microsoft?.refreshToken) {
    return 'graph';
  }
  if (
    correo.proveedor !== 'microsoft' &&
    (correo.contrasena !== '' || correo.google?.refreshToken)
  ) {
    return 'imap';
  }
  if (config.clientesIngesta.some((c) => c.nombre === correo.id)) {
    return 'envio';
  }
  return 'ninguno';
}

function correoListo(
  correo: ConfiguracionCorreo,
  config: Configuracion
): boolean {
  return metodoDe(correo, config) !== 'ninguno';
}

function faltanteDe(correo: ConfiguracionCorreo): string {
  return correo.proveedor === 'microsoft'
    ? correo.microsoft
      ? 'conectar la cuenta con Microsoft desde Ajustes → Correo'
      : 'la aplicación de Entra ID (Ajustes → Integraciones → Microsoft) y conectar la cuenta'
    : correo.proveedor === 'google'
      ? 'conectar la cuenta con Google (o poner una contraseña de aplicación) en Correo'
      : 'la contraseña del buzón (Correo → Editar conexión)';
}

/** El token de administracion, para las rutas que editan buzones. */
/**
 * La liga personal sirve hasta las tres de la tarde (hora del centro) del
 * dia en que se mando; si se mando despues de las tres, hasta las tres del
 * dia siguiente.
 */
/** El final del dia (23:59:59 en Mexico) en que se manda una liga. */
export function finDelDia(ahora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(ahora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return new Date(
    `${v('year')}-${v('month')}-${v('day')}T23:59:59-06:00`
  ).toISOString();
}

export function proximasTres(ahora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  }).formatToParts(ahora);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  const hora = Number(v('hour'));
  const dia = new Date(`${v('year')}-${v('month')}-${v('day')}T15:00:00-06:00`);
  if (hora >= 15) {
    dia.setUTCDate(dia.getUTCDate() + 1);
  }
  return dia.toISOString();
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== ''
    ? valor.trim()
    : undefined;
}

function tokenDe(contexto: Contexto): string {
  const encabezado = contexto.encabezados['authorization'] ?? '';
  return encabezado.toLowerCase().startsWith('bearer ')
    ? encabezado.slice(7).trim()
    : '';
}

function esAdmin(token: string, config: Configuracion): boolean {
  if (!config.adminToken || !token) {
    return false;
  }
  const a = Buffer.from(token);
  const b = Buffer.from(config.adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Quien puede cambiar cosas: una sesion vigente (entro con su codigo) o el
 * token de administracion (para automatizar).
 */
function exigirAdmin(
  contexto: Contexto,
  config: Configuracion,
  acceso?: Acceso
): void {
  const token = tokenDe(contexto);
  if (acceso?.sesionDe(token)) {
    return;
  }
  if (!config.adminToken && !config.acceso) {
    throw new ErrorConfiguracion(
      'Para editar desde el portal falta PUENTE_ADMIN_TOKEN (o el acceso con código por correo) en el entorno del puente.'
    );
  }
  if (!esAdmin(token, config)) {
    throw new ErrorPuente(
      config.acceso
        ? 'Hace falta entrar al portal con tu código de acceso.'
        : 'El token de administración no coincide con PUENTE_ADMIN_TOKEN del puente.',
      401
    );
  }
}

/** Rutas que el portal ya conoce pero que aun no tienen adaptador. */
const PENDIENTES_DE_CONSTRUIR: [string, string][] = [];

export function construirRutas(
  configInicial: Configuracion,
  cache = new Cache(),
  persistencia: Persistencia = new PersistenciaArchivos({
    datos: configInicial.directorioDatos,
    ingesta: configInicial.directorioIngesta ?? 'datos/ingesta',
    correo: configInicial.directorioCorreo,
    integraciones: configInicial.directorioIntegraciones
  }),
  almacen = new AlmacenIngesta(persistencia),
  almacenCorreo = new AlmacenCorreo(persistencia),
  integraciones?: {
    almacen: AlmacenIntegraciones;
    configurador: Configurador;
  },
  datos = abrirDatos(persistencia),
  /** Donde se apuntan las tareas que corren solas (index.ts las programa). */
  programables: Programable[] = []
): Router {
  const router = new Router();
  const ttl = configInicial.cacheSegundos;
  const acceso = new Acceso(datos.sesiones);
  // Cada llamada al modelo queda en la bitacora (las ultimas 300).
  establecerBitacora((entrada) => {
    void datos.iaBitacora.escribir(
      [entrada, ...datos.iaBitacora.leer()].slice(0, 300)
    );
  });

  const push = new Push(
    datos.pushClaves,
    datos.pushSuscripciones,
    datos.pushCola,
    () => cfg().acceso?.correos[0] ?? 'monitor@dealersolutions.com.mx'
  );
  /** La configuracion del modelo solo si ese uso esta permitido. */
  const iaPara = (uso: UsoIa) => {
    const usos = { ...USOS_POR_OMISION, ...datos.iaUsos.leer() };
    return usos[uso] ? cfg().ia : undefined;
  };

  // Se asigna mas abajo, cuando ya existen las fuentes que necesita; las
  // rutas lo usan en tiempo de peticion, cuando ya esta.
  let ia: ServiciosIa | undefined;
  const conIa = (tareas: TaskItem[]) =>
    ia ? ia.conVeredictos(tareas) : Promise.resolve(tareas);
  const hayOps = () =>
    datos.emisores
      .leer()
      .some(
        (e) => e.tipos.includes('pendientes') && !e.nombre.startsWith('correo-')
      );
  // Lo capturado desde Ajustes cambia la configuracion en caliente, asi que
  // las rutas la piden cada vez en lugar de quedarse con la del arranque.
  const cfg = (): Configuracion =>
    integraciones?.configurador.config() ?? configInicial;

  router.get('/salud', async () => ({
    ok: true,
    version: '0.1.0',
    ahora: new Date().toISOString(),
    conexiones: estadoDeConexiones(cfg(), almacenCorreo, hayOps)
  }));

  // --- Acceso: quien puede ver el portal ---
  //
  // Con EmailJS y una lista de correos configurados, todo lo que no sea
  // salud, el propio acceso, el regreso de OAuth o la ingesta (que trae sus
  // tokens) exige una sesion. Sin eso configurado, el puente queda abierto,
  // que es lo comodo en desarrollo.

  const LIBRES = new Set([
    'salud',
    'acceso',
    'ingesta',
    'recibido',
    'telegram'
  ]);
  router.proteger((segmentos, contexto) => {
    const config = cfg();
    if (!config.acceso) {
      return;
    }
    const primero = segmentos[0] ?? '';
    if (LIBRES.has(primero)) {
      return;
    }
    if (segmentos[0] === 'correo' && segmentos[1] === 'oauth') {
      return;
    }
    // El service worker recoge sus avisos sin sesion: se identifica con su
    // endpoint, que es una URL impredecible que solo el navegador conoce.
    if (
      segmentos[0] === 'push' &&
      (segmentos[1] === 'clave' || segmentos[1] === 'pendientes')
    ) {
      return;
    }
    const token = tokenDe(contexto);
    if (!acceso.sesionDe(token) && !esAdmin(token, config)) {
      throw new ErrorPuente(
        'Hace falta entrar al portal con tu código de acceso.',
        401
      );
    }
  });

  router.get('/acceso/estado', async (contexto) => {
    const config = cfg();
    const sesion = acceso.sesionDe(tokenDe(contexto));
    return {
      requerido: config.acceso !== undefined,
      sesion: sesion
        ? { correo: sesion.correo, vence: sesion.vence }
        : undefined
    };
  });

  router.post('/acceso/codigo', async ({ cuerpo }) => {
    const config = cfg();
    if (!config.acceso) {
      throw new ErrorConfiguracion(
        'El acceso con código no está configurado: faltan EmailJS y ACCESO_CORREOS.'
      );
    }
    const { correo } = (cuerpo ?? {}) as { correo?: string };
    await acceso.pedirCodigo(config.acceso, correo ?? '');
    return {
      enviado: true,
      mensaje: 'Si el correo está autorizado, en un momento le llega un código.'
    };
  });

  router.post('/acceso/entrar', async ({ cuerpo }) => {
    const { correo, codigo } = (cuerpo ?? {}) as {
      correo?: string;
      codigo?: string;
    };
    const config = cfg();
    const sesion: Sesion = await acceso.entrar(
      correo ?? '',
      codigo ?? '',
      config.acceso?.maestra && config.acceso.correos[0]
        ? { clave: config.acceso.maestra, correo: config.acceso.correos[0] }
        : undefined
    );
    return { token: sesion.token, correo: sesion.correo, vence: sesion.vence };
  });

  router.post('/acceso/salir', async (contexto) => {
    await acceso.salir(tokenDe(contexto));
    return { ok: true };
  });

  // --- Equipo: quienes son, para asignar y para la vista de equipo ---

  // El equipo es lo guardado en la aplicacion mas lo que manden por la API
  // los emisores con tipo `equipo` (por correo o identificador, sin repetir).
  const equipoCompleto = async (): Promise<Person[]> => {
    const vistos = new Map<string, Person>();
    const agregar = (p: Person) => {
      const llave = (p.email ?? p.id).toLowerCase();
      if (!vistos.has(llave)) {
        vistos.set(llave, p);
      }
    };
    datos.equipo.leer().forEach(agregar);
    for (const emisor of todosLosEmisores()) {
      if (emisor.tipos.includes('equipo')) {
        (
          almacen.leer<Person>('equipo', emisor.nombre)?.elementos ?? []
        ).forEach(agregar);
      }
    }
    return [...vistos.values()];
  };

  router.get('/equipo', async () => equipoCompleto());

  // --- Emisores: quien puede alimentar la API desde afuera ---
  //
  // Se crean desde la aplicacion. El token se enseña una sola vez, al crear;
  // despues solo se ve el nombre y que tipos puede mandar.

  const todosLosEmisores = (): ClienteIngesta[] => [
    ...cfg().clientesIngesta,
    ...datos.emisores.leer()
  ];

  router.get('/emisores', async () =>
    todosLosEmisores().map((e) => ({
      nombre: e.nombre,
      tipos: e.tipos,
      accountId: e.accountId,
      vigenciaSegundos: e.vigenciaSegundos,
      deEntorno: cfg().clientesIngesta.some((c) => c.nombre === e.nombre),
      ultimoEnvio:
        [
          ...e.tipos.map(
            (t) => almacen.leer(t as TipoIngesta, e.nombre)?.recibidoEn
          ),
          ...Object.values(datos.ejecuciones.leer())
            .filter((x) => x.emisor === e.nombre)
            .map((x) => x.recibidoEn)
        ]
          .filter((x): x is string => !!x)
          .sort()
          .pop() ?? undefined
    }))
  );

  router.post('/emisores/guardar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      nombre?: string;
      tipos?: string[];
      accountId?: string;
      vigenciaSegundos?: number;
    };
    const nombre = (cuerpo.nombre ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!nombre) {
      throw new ErrorPuente('El emisor necesita un nombre.', 400);
    }
    if (todosLosEmisores().some((e) => e.nombre === nombre)) {
      throw new ErrorPuente(`Ya hay un emisor llamado "${nombre}".`, 400);
    }
    const tipos = (cuerpo.tipos ?? []).filter((t) => TIPOS_EMISOR.includes(t));
    if (tipos.length === 0) {
      throw new ErrorPuente(
        'El emisor necesita al menos un tipo de envío.',
        400
      );
    }
    const emisor: ClienteIngesta = {
      nombre,
      token: randomBytes(24).toString('base64url'),
      tipos,
      accountId: (cuerpo.accountId ?? '').trim() || 'ops',
      vigenciaSegundos: Number(cuerpo.vigenciaSegundos) || 0
    };
    await datos.emisores.escribir([...datos.emisores.leer(), emisor]);
    // El token solo viaja aqui, una vez.
    return { ...emisor, aviso: 'Guarda este token: no se vuelve a mostrar.' };
  });

  router.post('/emisores/borrar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { nombre } = (contexto.cuerpo ?? {}) as { nombre?: string };
    await datos.emisores.escribir(
      datos.emisores.leer().filter((e) => e.nombre !== nombre)
    );
    return { ok: true };
  });

  router.post('/equipo/guardar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { personas } = (contexto.cuerpo ?? {}) as { personas?: unknown };
    if (!Array.isArray(personas)) {
      throw new ErrorPuente('"personas" debe ser una lista.', 400);
    }
    const limpias: Person[] = personas.map((cruda, i) => {
      const p = (cruda ?? {}) as Record<string, unknown>;
      const name = typeof p['name'] === 'string' ? p['name'].trim() : '';
      if (!name) {
        throw new ErrorPuente(`personas[${i}].name es obligatorio.`, 400);
      }
      const email =
        typeof p['email'] === 'string' && p['email'].trim()
          ? p['email'].trim().toLowerCase()
          : undefined;
      return {
        id:
          typeof p['id'] === 'string' && p['id'].trim()
            ? p['id'].trim()
            : (email ??
              name
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]+/g, '-')),
        name,
        email,
        role:
          typeof p['role'] === 'string' && p['role'].trim()
            ? p['role'].trim()
            : undefined,
        pedirEstatus: p['pedirEstatus'] === true ? true : undefined
      };
    });
    return datos.equipo.escribir(limpias);
  });

  // --- Pendientes personales: se guardan completos en cada cambio ---

  router.get('/personales/tasks', async () =>
    conNotas(await conIa(datos.personales.leer()))
  );

  router.post('/personales/guardar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { pendientes } = (contexto.cuerpo ?? {}) as { pendientes?: unknown };
    if (!Array.isArray(pendientes)) {
      throw new ErrorPuente('"pendientes" debe ser una lista.', 400);
    }
    const ahora = new Date().toISOString();
    const limpios: TaskItem[] = pendientes.map((cruda, i) => {
      const t = (cruda ?? {}) as Record<string, unknown>;
      const title = typeof t['title'] === 'string' ? t['title'].trim() : '';
      if (!title) {
        throw new ErrorPuente(`pendientes[${i}].title es obligatorio.`, 400);
      }
      const texto = (v: unknown) =>
        typeof v === 'string' && v.trim() ? v.trim() : undefined;
      return {
        id: texto(t['id']) ?? `local-${i}-${Date.now()}`,
        title,
        description: texto(t['description']),
        status:
          (['pendiente', 'en_progreso', 'bloqueado', 'hecho'] as const).find(
            (e) => e === t['status']
          ) ?? 'pendiente',
        // Lo personal siempre es alta, y urgente si tiene fecha.
        priority:
          t['personal'] === true
            ? texto(t['dueDate'])
              ? 'urgente'
              : 'alta'
            : ((['baja', 'media', 'alta', 'urgente'] as const).find(
                (p) => p === t['priority']
              ) ?? 'media'),
        dueDate: texto(t['dueDate']),
        dueHasTime: t['dueHasTime'] === true ? true : undefined,
        accountId: 'mios',
        origin: 'local',
        project: texto(t['project']),
        company: texto(t['company']),
        personal: t['personal'] === true ? true : undefined,
        tags: Array.isArray(t['tags'])
          ? (t['tags'] as unknown[]).filter(
              (x): x is string => typeof x === 'string'
            )
          : [],
        updatedAt: texto(t['updatedAt']) ?? ahora
      };
    });
    return datos.personales.escribir(limpios);
  });

  // --- Dominios: registro, vencimiento y costo de renovacion ---

  router.get('/dominios', async () => datos.dominios.leer());

  router.get('/dominios/licenses', async () =>
    dominiosComoLicencias(datos.dominios.leer(), 'dominios')
  );

  router.post('/dominios/guardar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { dominios } = (contexto.cuerpo ?? {}) as { dominios?: unknown };
    if (!Array.isArray(dominios)) {
      throw new ErrorPuente('"dominios" debe ser una lista.', 400);
    }
    const limpios: Dominio[] = dominios.map((d, i) => {
      try {
        return validarDominio(d, `dominios[${i}]`);
      } catch (error) {
        throw new ErrorPuente(
          error instanceof Error ? error.message : String(error),
          400
        );
      }
    });
    const nombres = new Set<string>();
    for (const d of limpios) {
      if (nombres.has(d.nombre)) {
        throw new ErrorPuente(`El dominio ${d.nombre} está repetido.`, 400);
      }
      nombres.add(d.nombre);
    }
    return datos.dominios.escribir(
      limpios.sort((a, b) => a.venceEn.localeCompare(b.venceEn))
    );
  });

  // --- Licencias ---

  router.get('/licencias/anthropic/licenses', () =>
    cache.obtener('licencias:anthropic', ttl.licencias, () =>
      licenciasAnthropic(exigir(cfg().anthropic, 'anthropic'))
    )
  );

  router.get('/licencias/openrouter/licenses', () =>
    cache.obtener('licencias:openrouter', ttl.licencias, () =>
      consumoOpenRouter(exigir(cfg().ia, 'openrouter'))
    )
  );

  router.get('/licencias/cursor/licenses', () =>
    cache.obtener('licencias:cursor', ttl.licencias, () =>
      licenciasCursor(exigir(cfg().cursor, 'cursor'))
    )
  );

  router.get('/licencias/figma/licenses', () =>
    cache.obtener('licencias:figma', ttl.licencias, () =>
      licenciasFigma(exigir(cfg().figma, 'figma'))
    )
  );

  // --- Vercel: despliegues, estado de la plataforma y su propia licencia ---

  router.get('/vercel/deployments', () =>
    cache.obtener('vercel:despliegues', ttl.despliegues, () =>
      desplieguesVercel(exigir(cfg().vercel, 'vercel'))
    )
  );

  router.get('/vercel/platform-status', () =>
    cache.obtener('vercel:estado', ttl.estadoPlataforma, () =>
      estadoPlataformaVercel(exigir(cfg().vercel, 'vercel'))
    )
  );

  router.get('/vercel/licenses', async () =>
    licenciasVercel(exigir(cfg().vercel, 'vercel'))
  );

  // --- Monitoreo ---

  router.get('/monitoreo/estado/targets', () =>
    cache.obtener('monitoreo:destinos', ttl.monitoreo, () =>
      destinosMonitoreados(
        exigir(cfg().monitoreo, 'monitoreo'),
        datos.monitoreoHistorial
      )
    )
  );

  // --- CRM de Odoo ---

  const odoo = () =>
    cache.obtener('odoo:crm', ttl.crm, () =>
      crmOdoo(exigir(cfg().odoo, 'odoo'))
    );

  router.get(
    '/odoo/itech/opportunities',
    async () => (await odoo()).oportunidades
  );
  router.get('/odoo/itech/activities', async () => (await odoo()).actividades);
  router.get('/odoo/itech/tasks', async () => {
    const odooConfig = exigir(cfg().odoo, 'odoo');
    return actividadesComoPendientes(
      (await odoo()).actividades,
      odooConfig.accountId
    );
  });

  // --- Conexiones que el portal ya espera y el puente todavia no sirve ---
  //
  // Se registran a proposito en lugar de dejarlas caer en el 404 generico: si
  // alguien cambia esa conexion a modo gateway antes de tiempo, Ajustes le dice
  // que falta construirla, en vez de un "no hay nada en esta ruta" que parece
  // un error de escritura en la configuracion.
  for (const [ruta, nombre] of PENDIENTES_DE_CONSTRUIR) {
    router.get(ruta, async () => {
      throw new ErrorPuente(
        `La conexión "${nombre}" todavía no está construida en el puente. Déjala en modo demostración hasta que exista.`,
        501
      );
    });
  }

  // --- Repositorios de GitHub ---

  router.get('/github/repos', () =>
    cache.obtener('github:repos', ttl.repos, () =>
      reposGithub(exigir(cfg().github, 'github'))
    )
  );

  // --- Buzones de correo: juntas, pendientes y licencias deducidas ---
  //
  // Tres caminos segun lo que haya. Gmail, iCloud y Neubox se leen por IMAP
  // con su contraseña. Microsoft ya no acepta IMAP con contraseña: se entra
  // por Microsoft Graph con la aplicacion de Entra ID y el consentimiento que
  // se da desde Ajustes. Y cualquier buzon sin credencial pero con un emisor
  // de INGESTA_CLIENTES del mismo nombre se sirve de lo que mando el barrido
  // de Mail.app. Para el portal la ruta es la misma en los tres casos.
  //
  // Leer un buzon tarda segundos y los tres recursos salen de la misma
  // lectura, asi que se cachea la lectura completa y cada ruta toma su parte.
  // `/correo/:id` responde 404 si el buzon no existe ni en CORREO_CUENTAS ni
  // guardado, que es distinto de "existe pero le falta algo" (503).

  const buzon = (id: string): ConfiguracionCorreo => {
    const cuenta = almacenCorreo.efectiva(
      id,
      cfg().correos.find((c) => c.id === id),
      cfg().correoDiasAtras,
      cfg().microsoftApp,
      cfg().googleApp
    );
    if (!cuenta) {
      throw new ErrorPuente(`No hay un buzón "${id}" configurado.`, 404);
    }
    return cuenta;
  };

  const hechos = () =>
    new Set(
      Object.entries(datos.anotaciones.leer())
        .filter(([, nota]) => nota.hecho)
        .map(([id]) => id)
    );

  /**
   * Lo que la IA ya vio se guarda por clave de correo. Se limpia lo mas
   * viejo que la ventana de analisis mas un mes, para que el archivo no
   * crezca sin fin.
   */
  const opcionesIa = () => {
    const ia = iaPara('correo');
    if (!ia) {
      return undefined;
    }
    const vistos = datos.iaCorreo.leer();
    return {
      dias: ia.dias,
      maximo: ia.maximo,
      yaAnalizado: (clave: string) => clave in vistos
    };
  };

  const clasificar = async (
    cuenta: ConfiguracionCorreo,
    lectura: DatosCorreo
  ): Promise<TaskItem[]> => {
    const ia = iaPara('correo');
    if (!ia || lectura.paraIa.length === 0) {
      return [];
    }
    const ahora = new Date();
    let resultados: Clasificacion[];
    try {
      resultados = await clasificarCorreos(
        ia,
        lectura.paraIa,
        ahora,
        pistasParaModelo(datos.aprendido.leer())
      );
    } catch (error) {
      // La IA es un extra: si falla, el buzon se sigue leyendo sin ella.
      console.warn(
        `[puente] la IA no pudo clasificar el correo de "${cuenta.id}": ${(error as Error).message}`
      );
      return [];
    }
    const limite = ahora.getTime() - (ia.dias + 30) * 86_400_000;
    const vistos = Object.fromEntries(
      Object.entries(datos.iaCorreo.leer()).filter(
        ([, c]) => Date.parse(c.analizadoEn) >= limite
      )
    );
    for (const r of resultados) {
      vistos[r.id] = r;
    }
    await datos.iaCorreo.escribir(vistos);
    const porClave = new Map(lectura.paraIa.map((c) => [c.clave, c]));
    return resultados
      .filter((r) => r.esPendiente)
      .map((r) =>
        pendienteDeClasificacion(
          r,
          porClave.get(r.id) as (typeof lectura.paraIa)[number],
          cuenta.accountId
        )
      );
  };

  const leido = (cuenta: ConfiguracionCorreo) =>
    cache.obtener(`correo:${cuenta.id}`, ttl.correo, async () => {
      const ia = opcionesIa();
      const lectura =
        cuenta.proveedor === 'microsoft'
          ? await leerCorreoMicrosoft(cuenta, new Date(), ia)
          : await leerCorreo(cuenta, new Date(), ia);
      const empresa = empresaDeCuenta(cuenta.id);
      const detectados = [
        ...lectura.pendientes.map((t) => ({
          ...t,
          company: t.company ?? empresa
        })),
        ...(await clasificar(cuenta, lectura)).map((t) => ({
          ...t,
          company: t.company ?? empresa
        }))
      ];
      // Lo detectado se registra: un pendiente no desaparece porque el
      // correo que lo origino ya sea viejo.
      const registro = datos.registroCorreo.leer();
      const actual = registrar(registro[cuenta.id] ?? [], detectados, hechos());
      await datos.registroCorreo.escribir({ ...registro, [cuenta.id]: actual });
      return { ...lectura, pendientes: actual };
    });

  /**
   * Lo leido del buzon sin hacer esperar al portal: si hay algo en cache
   * (aunque haya vencido) se contesta con eso y se renueva atras; si el
   * proceso acaba de arrancar y todavia no se ha leido nada, los pendientes
   * salen del registro en disco mientras la primera lectura (que con miles
   * de correos y la IA tarda minutos) corre sola. Juntas y licencias no
   * tienen registro, asi que esas si esperan la primera vez.
   */
  const leidoSinEsperar = async (
    cuenta: ConfiguracionCorreo,
    parte: 'licencias' | 'pendientes' | 'juntas'
  ): Promise<unknown[]> => {
    type Lectura = Awaited<ReturnType<typeof leido>>;
    const guardado = cache.guardado<Lectura>(`correo:${cuenta.id}`);
    if (guardado) {
      if (!guardado.vigente) {
        leido(cuenta).catch(() => undefined);
      }
      return guardado.valor[parte];
    }
    const lectura = leido(cuenta);
    if (parte === 'pendientes') {
      const registrado = datos.registroCorreo.leer()[cuenta.id];
      if (registrado && registrado.length > 0) {
        lectura.catch(() => undefined);
        return registrado;
      }
    }
    return (await lectura)[parte];
  };

  const conNotas = (tareas: TaskItem[]) =>
    anotar(tareas, datos.anotaciones.leer());

  const recibidoDe = (cuenta: ConfiguracionCorreo, tipo: TipoIngesta) => {
    const emisor = cfg().clientesIngesta.find((c) => c.nombre === cuenta.id);
    if (!emisor) {
      throw new ErrorConfiguracion(
        `El buzón "${cuenta.id}" no tiene con qué leerse: falta ${faltanteDe(cuenta)}.`
      );
    }
    // Lo que el emisor no prometio mandar no es un error: simplemente no hay.
    return emisor.tipos.includes(tipo)
      ? servirRecibido(almacen, emisor, tipo)
      : [];
  };

  const correo = async (
    id: string,
    tipo: TipoIngesta,
    parte: 'licencias' | 'pendientes' | 'juntas'
  ): Promise<unknown[]> => {
    const cuenta = buzon(id);
    const metodo = metodoDe(cuenta, cfg());
    const lista =
      metodo === 'graph' || metodo === 'imap'
        ? await leidoSinEsperar(cuenta, parte)
        : recibidoDe(cuenta, tipo);
    if (parte !== 'pendientes') {
      return lista;
    }
    // Lo de este buzon se homologa contra lo registrado de los demas: el
    // mismo correo en dos buzones se sirve una vez, y de los avisos
    // repetidos solo el ultimo. Los demas buzones se leen del registro, no
    // del proveedor, para no esperar por ellos.
    const registro = datos.registroCorreo.leer();
    const porCuenta: Record<string, TaskItem[]> = {};
    for (const [otra, tareas] of Object.entries(registro)) {
      if (otra !== cuenta.id) {
        porCuenta[otra] = tareas;
      }
    }
    porCuenta[cuenta.id] = lista as TaskItem[];
    return conNotas(
      aplicarAprendido(
        conRemitente(
          homologarPendientes(porCuenta)[cuenta.id] ?? [],
          await equipoCompleto()
        ),
        datos.aprendido.leer()
      )
    );
  };

  router.get('/correo/:id/licenses', ({ segmentos }) =>
    correo(segmentos[1] as string, 'licencias', 'licencias')
  );

  router.get('/correo/:id/tasks', ({ segmentos }) =>
    correo(segmentos[1] as string, 'pendientes', 'pendientes')
  );

  router.get('/correo/:id/meetings', async ({ segmentos, parametros }) => {
    const juntas = (await correo(
      segmentos[1] as string,
      'juntas',
      'juntas'
    )) as {
      start: string;
    }[];
    const desde = parametros.get('from');
    const hasta = parametros.get('to');
    return juntas.filter(
      (junta) =>
        (!desde || junta.start >= desde) && (!hasta || junta.start <= hasta)
    );
  });

  // --- Editar y conectar buzones desde Ajustes ---
  //
  // El estado se puede consultar sin token porque no expone secretos: dice
  // que hay y que falta. Guardar, probar y conectar piden PUENTE_ADMIN_TOKEN.

  const estadoDeBuzon = (cuenta: ConfiguracionCorreo) => ({
    id: cuenta.id,
    proveedor: cuenta.proveedor,
    usuario: cuenta.usuario,
    host: cuenta.host,
    puerto: cuenta.puerto,
    buzones: cuenta.buzones,
    metodo: metodoDe(cuenta, cfg()),
    conContrasena: cuenta.contrasena !== '',
    conAplicacion:
      cuenta.proveedor === 'google'
        ? cuenta.google !== undefined
        : cuenta.microsoft !== undefined,
    tenant: cuenta.microsoft?.tenant,
    clientId: cuenta.microsoft?.clientId ?? cuenta.google?.clientId,
    conectadaComo:
      cuenta.microsoft?.conectadaComo ?? cuenta.google?.conectadaComo,
    faltante:
      metodoDe(cuenta, cfg()) === 'ninguno' ? faltanteDe(cuenta) : undefined,
    redirectUri: `${cfg().urlPublica}/correo/oauth/callback`
  });

  router.get('/correo/:id/estado', async ({ segmentos }) =>
    estadoDeBuzon(buzon(segmentos[1] as string))
  );

  interface CuerpoGuardar {
    proveedor?: ConfiguracionCorreo['proveedor'];
    usuario?: string;
    host?: string;
    puerto?: number;
    contrasena?: string;
    buzones?: string[];
    tenant?: string;
    clientId?: string;
    clientSecret?: string;
  }

  router.post('/correo/:id/guardar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const id = contexto.segmentos[1] as string;
    const cuerpo = (contexto.cuerpo ?? {}) as CuerpoGuardar;
    await almacenCorreo.guardar(id, {
      proveedor: cuerpo.proveedor,
      usuario: texto(cuerpo.usuario),
      host: texto(cuerpo.host),
      puerto: cuerpo.puerto ? Number(cuerpo.puerto) || undefined : undefined,
      contrasena: texto(cuerpo.contrasena),
      buzones: Array.isArray(cuerpo.buzones) ? cuerpo.buzones : undefined,
      microsoft:
        cuerpo.tenant || cuerpo.clientId || cuerpo.clientSecret
          ? {
              tenant: texto(cuerpo.tenant),
              clientId: texto(cuerpo.clientId),
              clientSecret: texto(cuerpo.clientSecret)
            }
          : undefined
    });
    cache.olvidar(`correo:${id}`);
    olvidarAcceso(id);
    return estadoDeBuzon(buzon(id));
  });

  router.post('/correo/:id/borrar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const id = contexto.segmentos[1] as string;
    // Borrar dos veces no es error: el resultado es el mismo.
    await almacenCorreo.borrar(id);
    cache.olvidar(`correo:${id}`);
    olvidarAcceso(id);
    olvidarAccesoGoogle(id);
    return { ok: true };
  });

  router.post('/correo/:id/probar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuenta = buzon(contexto.segmentos[1] as string);
    try {
      if (cuenta.proveedor === 'microsoft') {
        if (!cuenta.microsoft) {
          return {
            ok: false,
            mensaje: 'Faltan el client ID y el client secret.'
          };
        }
        const quien = await quienSoy(cuenta.id, cuenta.microsoft);
        return {
          ok: true,
          mensaje: `Conectado por Microsoft Graph como ${quien}.`
        };
      }
      const accessToken = cuenta.google?.refreshToken
        ? await tokenDeAccesoGoogle(cuenta.id, cuenta.google)
        : undefined;
      if (!cuenta.contrasena && !accessToken) {
        return {
          ok: false,
          mensaje:
            cuenta.proveedor === 'google'
              ? 'Falta conectar la cuenta con Google (o una contraseña de aplicación).'
              : 'Falta la contraseña del buzón.'
        };
      }
      const cliente = await ClienteImap.conectar({
        host: cuenta.host,
        puerto: cuenta.puerto,
        usuario: cuenta.usuario,
        contrasena: cuenta.contrasena,
        accessToken,
        tiempoLimiteMs: 15_000
      });
      try {
        const total = await cliente.seleccionar(cuenta.buzones[0] ?? 'INBOX');
        return {
          ok: true,
          mensaje: `Entró por IMAP a ${cuenta.host} como ${cuenta.usuario}; "${cuenta.buzones[0] ?? 'INBOX'}" tiene ${total} mensajes.`
        };
      } finally {
        await cliente.cerrar();
      }
    } catch (error) {
      return {
        ok: false,
        mensaje: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // El consentimiento de Microsoft: se manda a la persona a login.microsoftonline.com
  // con un `state` que solo vive aqui diez minutos, y al regresar se cambia el
  // codigo por el refresh token y se guarda.
  const estadosOauth = new Map<
    string,
    { id: string; volver: string; vence: number }
  >();

  router.post('/correo/:id/oauth/inicio', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuenta = buzon(contexto.segmentos[1] as string);
    const app =
      cuenta.proveedor === 'google' ? cuenta.google : cuenta.microsoft;
    if (!app) {
      throw new ErrorConfiguracion(
        cuenta.proveedor === 'google'
          ? 'Falta la aplicación OAuth de Google (client ID y secret): configúrala en Correo → Google.'
          : 'Falta la aplicación de Entra ID (client ID y secret): configúrala en Correo → Microsoft.'
      );
    }
    const { volver } = (contexto.cuerpo ?? {}) as { volver?: string };
    const state = randomBytes(24).toString('base64url');
    for (const [llave, valor] of estadosOauth) {
      if (valor.vence < Date.now()) {
        estadosOauth.delete(llave);
      }
    }
    estadosOauth.set(state, {
      id: cuenta.id,
      volver: volver || '/',
      vence: Date.now() + 10 * 60_000
    });
    const redirectUri = `${cfg().urlPublica}/correo/oauth/callback`;
    return {
      url:
        cuenta.proveedor === 'google'
          ? urlDeAutorizacionGoogle(
              cuenta.google as NonNullable<typeof cuenta.google>,
              redirectUri,
              state,
              cuenta.usuario
            )
          : urlDeAutorizacion(
              cuenta.microsoft as NonNullable<typeof cuenta.microsoft>,
              redirectUri,
              state,
              cuenta.usuario
            )
    };
  });

  router.get('/correo/oauth/callback', async ({ parametros }) => {
    const state = parametros.get('state') ?? '';
    const pendiente = estadosOauth.get(state);
    estadosOauth.delete(state);
    if (!pendiente || pendiente.vence < Date.now()) {
      throw new ErrorPuente(
        'El regreso de Microsoft no corresponde a ninguna conexión en curso (o tardó más de diez minutos). Vuelve a intentarlo desde Ajustes.',
        400
      );
    }
    const regresar = (resultado: 'ok' | 'error', mensaje?: string) => {
      const url = new URL(pendiente.volver);
      url.searchParams.set('correo', pendiente.id);
      url.searchParams.set('oauth', resultado);
      if (mensaje) {
        url.searchParams.set('mensaje', mensaje);
      }
      return new Redireccion(url.toString());
    };
    const errorDeMicrosoft = parametros.get('error');
    if (errorDeMicrosoft) {
      return regresar(
        'error',
        `${errorDeMicrosoft}: ${parametros.get('error_description') ?? ''}`.trim()
      );
    }
    const cuenta = buzon(pendiente.id);
    const redirectUri = `${cfg().urlPublica}/correo/oauth/callback`;
    try {
      if (cuenta.proveedor === 'google') {
        if (!cuenta.google) {
          return regresar(
            'error',
            'La cuenta ya no tiene aplicación de Google.'
          );
        }
        const tokens = await canjearCodigoGoogle(
          cuenta.google,
          parametros.get('code') ?? '',
          redirectUri
        );
        const quien = await quienSoyGoogle(tokens.accessToken);
        await almacenCorreo.guardar(cuenta.id, {
          google: { refreshToken: tokens.refreshToken, conectadaComo: quien }
        });
        cache.olvidar(`correo:${cuenta.id}`);
        olvidarAccesoGoogle(cuenta.id);
        return regresar('ok', `Conectada como ${quien}`);
      }
      if (!cuenta.microsoft) {
        return regresar(
          'error',
          'La cuenta ya no tiene aplicación registrada.'
        );
      }
      const tokens = await canjearCodigo(
        cuenta.microsoft,
        parametros.get('code') ?? '',
        redirectUri
      );
      const quien = await quienSoy(
        cuenta.id,
        cuenta.microsoft,
        tokens.accessToken
      );
      await almacenCorreo.guardar(cuenta.id, {
        microsoft: { refreshToken: tokens.refreshToken, conectadaComo: quien }
      });
      cache.olvidar(`correo:${cuenta.id}`);
      olvidarAcceso(cuenta.id);
      return regresar('ok', `Conectada como ${quien}`);
    } catch (error) {
      return regresar(
        'error',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // --- Configurar integraciones desde Ajustes ---
  //
  // Cada integracion es un juego de variables (las de .env.example). Listar
  // no pide token y no expone secretos: dice que variables hay, cuales estan
  // definidas y el valor de las que no son secretas. Guardar y probar piden
  // PUENTE_ADMIN_TOKEN.

  const estadoDeIntegracion = (id: string) => {
    const definicion = integracion(id);
    if (!definicion) {
      throw new ErrorPuente(`No hay una integración "${id}".`, 404);
    }
    const guardadas = integraciones?.almacen.variablesDe(id) ?? {};
    const estado = estadoDeConexiones(cfg(), almacenCorreo, hayOps).find(
      (e) => e.conexion === id
    );
    // Acceso y la aplicacion de Microsoft no son conexiones del portal: su
    // estado sale de la configuracion misma.
    const config = cfg();
    const sueltas: Record<string, boolean> = {
      acceso: config.acceso !== undefined,
      microsoft: config.microsoftApp !== undefined,
      google: config.googleApp !== undefined,
      openrouter: config.ia !== undefined,
      fireflies: config.fireflies !== undefined,
      telegram: config.telegram !== undefined
    };
    const configurada =
      id in sueltas ? (sueltas[id] as boolean) : (estado?.configurada ?? false);
    return {
      id,
      etiqueta: definicion.etiqueta,
      kind: definicion.kind,
      configurada,
      faltante: configurada ? undefined : estado?.faltante,
      editable: integraciones !== undefined,
      campos: definicion.campos.map((campo) => {
        const enEntorno = process.env[campo.variable];
        const guardada = guardadas[campo.variable];
        const definida = !!(guardada ?? enEntorno);
        return {
          ...campo,
          definida,
          origen: guardada ? 'ajustes' : enEntorno ? 'entorno' : undefined,
          valor:
            campo.tipo === 'secreto' ? undefined : (guardada ?? enEntorno ?? '')
        };
      })
    };
  };

  router.get('/integraciones', async () =>
    INTEGRACIONES.map((i) => estadoDeIntegracion(i.id))
  );

  router.get('/integraciones/:id/estado', async ({ segmentos }) =>
    estadoDeIntegracion(segmentos[1] as string)
  );

  router.post('/integraciones/:id/guardar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const id = contexto.segmentos[1] as string;
    const definicion = integracion(id);
    if (!definicion || !integraciones) {
      throw new ErrorPuente(`No hay una integración "${id}".`, 404);
    }
    const { variables } = (contexto.cuerpo ?? {}) as {
      variables?: Record<string, unknown>;
    };
    const permitidas = new Set(definicion.campos.map((c) => c.variable));
    const cambios: Record<string, string | undefined> = {};
    for (const [nombre, valor] of Object.entries(variables ?? {})) {
      if (!permitidas.has(nombre)) {
        throw new ErrorPuente(
          `"${nombre}" no es una variable de la integración "${id}".`,
          400
        );
      }
      const campo = definicion.campos.find((c) => c.variable === nombre);
      cambios[nombre] =
        valor === undefined || valor === null
          ? undefined
          : campo?.tipo === 'largo'
            ? // En el formulario va uno por linea; en la variable, con punto y coma.
              String(valor)
                .split(/\r?\n/)
                .map((linea) => linea.trim())
                .filter(Boolean)
                .join(';')
            : String(valor);
    }
    await integraciones.almacen.guardar(id, cambios);
    integraciones.configurador.invalidar();
    cache.olvidar();
    return estadoDeIntegracion(id);
  });

  router.post('/integraciones/:id/probar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const definicion = integracion(contexto.segmentos[1] as string);
    if (!definicion) {
      throw new ErrorPuente(
        `No hay una integración "${contexto.segmentos[1]}".`,
        404
      );
    }
    try {
      return { ok: true, mensaje: await definicion.probar(cfg()) };
    } catch (error) {
      return {
        ok: false,
        mensaje: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // --- Ops: los pendientes que mandan por la API los emisores del equipo ---
  //
  // No hay un tablero de Ops que consultar: Ops es lo que otros sistemas nos
  // empujan con su token (POST /ingesta/pendientes). Aqui se juntan todos los
  // emisores de pendientes que no son un buzon de correo.

  const pendientesOps = (): TaskItem[] => {
    const buzones = new Set(buzones_(cfg(), almacenCorreo).map((c) => c.id));
    return todosLosEmisores()
      .filter((e) => e.tipos.includes('pendientes') && !buzones.has(e.nombre))
      .flatMap(
        (e) => almacen.leer<TaskItem>('pendientes', e.nombre)?.elementos ?? []
      );
  };

  router.get('/ops/pendientes/tasks', async () =>
    conNotas(await conIa(pendientesOps()))
  );

  // --- Anotar un pendiente: comentario, hecho, asignacion ---
  //
  // Vale para cualquier pendiente, venga del correo, de Ops, de Odoo o de los
  // personales. Al asignar, la persona recibe un correo con el detalle por
  // EmailJS (el mismo servicio del acceso).

  /**
   * La liga personal de alguien del equipo: con ella ve sus pendientes,
   * comenta y los marca, sin entrar al portal. El token se crea la primera
   * vez y no caduca; se puede renovar borrandolo de datos/ligas-equipo.json.
   */
  /**
   * La liga personal de alguien. Sin `tarea`, enseña todos sus pendientes y
   * vence a las tres de la tarde del dia (la de pedir estatus). Con `tarea`,
   * enseña solo ese pendiente y vence al final del dia en que se mando: es
   * la del correo de asignacion. Si la tarea dura mas, la persona sigue
   * reportando con las ligas de la solicitud de estatus (martes y jueves).
   */
  const ligaDe = async (persona: Person, tarea?: string): Promise<string> => {
    const ahora = new Date();
    const token = randomBytes(18).toString('base64url');
    const vigentes = Object.fromEntries(
      Object.entries(datos.ligasEquipo.leer()).filter(
        ([, l]) => Date.parse(l.vence) > ahora.getTime()
      )
    );
    await datos.ligasEquipo.escribir({
      ...vigentes,
      [token]: tarea
        ? { persona: persona.id, vence: finDelDia(ahora), tarea }
        : { persona: persona.id, vence: proximasTres(ahora) }
    });
    return `${cfg().urlPortal}/mio/${token}`;
  };

  /**
   * Asigna un pendiente a alguien del equipo y le avisa por correo. Devuelve
   * el aviso (que se mando, o por que no) para enseñarlo en el portal.
   */
  const asignarPendiente = async (
    id: string,
    quien: string,
    tarea: Partial<TaskItem>,
    sesion: Sesion | undefined
  ): Promise<string | undefined> => {
    const todas = datos.anotaciones.leer();
    const nota = todas[id] ?? { comentarios: [], actualizadoEn: '' };
    const buscado = quien.trim().toLowerCase();
    const persona = (await equipoCompleto()).find(
      (p) =>
        p.id.toLowerCase() === buscado || p.email?.toLowerCase() === buscado
    );
    if (!persona) {
      throw new ErrorPuente(`No hay nadie en el equipo con "${quien}".`, 400);
    }
    nota.asignado = persona;
    nota.actualizadoEn = new Date().toISOString();
    await datos.anotaciones.escribir({
      ...todas,
      [id]: conEvento(nota, {
        by: sesion?.correo ?? 'administración',
        kind: 'asignacion',
        text: `Asignado a ${persona.name}`
      })
    });
    if (persona.email) {
      void push.avisar(
        {
          titulo: `Te asignaron: ${tarea.title ?? id}`,
          cuerpo: [
            tarea.priority ? `Prioridad ${tarea.priority}` : undefined,
            tarea.dueDate
              ? `vence ${new Date(tarea.dueDate).toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' })}`
              : undefined,
            sesion ? `de ${sesion.correo}` : undefined
          ]
            .filter((x) => x)
            .join(' · '),
          url: '/pendientes',
          etiqueta: `asignado:${id}`
        },
        persona.email
      );
    }
    const config = cfg();
    if (!persona.email) {
      return 'Asignado; esa persona no tiene correo en el equipo, no se le avisó.';
    }
    if (!config.acceso) {
      return 'Asignado; para avisar por correo configura el acceso (EmailJS) en Equipo.';
    }
    const t = tarea;
    const html =
      `<p>Te asignaron un pendiente en <strong>DS Monitor</strong>${sesion ? ` (${sesion.correo})` : ''}:</p>` +
      `<p style="font-size:20px"><strong>${escapar(t.title ?? id)}</strong></p>` +
      (t.description ? `<p>${escapar(t.description)}</p>` : '') +
      `<p>Prioridad: ${escapar(t.priority ?? 'media')}` +
      (t.dueDate
        ? ` · Vence: ${new Date(t.dueDate).toLocaleDateString('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' })}`
        : '') +
      (t.project ? ` · Proyecto: ${escapar(t.project)}` : '') +
      `</p>` +
      (nota.comentarios.length > 0
        ? `<p>Comentarios:</p><ul>${nota.comentarios.map((c) => `<li>${escapar(c.text)}</li>`).join('')}</ul>`
        : '') +
      `<p><a href="${await ligaDe(persona, id)}" style="display:inline-block;padding:10px 16px;background:#04202B;color:#fff;text-decoration:none;border-radius:6px">Ver el pendiente, cambiar su estado o comentar</a></p>` +
      `<p style="color:#666;font-size:12px">La liga es personal y solo abre este pendiente; no hace falta usuario ni código. Sirve hasta el final del día de hoy: no hay que terminar la tarea hoy, pero sí conviene dejar una línea de en qué va. Después te llega otra liga con la solicitud de estatus.</p>`;
    try {
      await enviarPorEmailJs(config.acceso, persona.email, '', false, {
        titulo: `Pendiente asignado: ${t.title ?? id}`,
        html
      });
      return `Se avisó por correo a ${persona.email}.`;
    } catch (error) {
      return `Asignado, pero no se pudo mandar el correo: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  router.post('/pendientes/anotar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      id?: string;
      comentario?: string;
      hecho?: boolean;
      /** Estado elegido a mano: pendiente, en_progreso, bloqueado o hecho. */
      estado?: TaskStatus;
      eliminar?: boolean;
      cambios?: CambiosPendiente;
      asignarA?: string;
      tarea?: Partial<TaskItem>;
    };
    const id = (cuerpo.id ?? '').trim();
    if (!id) {
      throw new ErrorPuente('Falta el identificador del pendiente.', 400);
    }
    const sesion = acceso.sesionDe(tokenDe(contexto));
    const todas = datos.anotaciones.leer();
    let nota: Anotacion = todas[id] ?? { comentarios: [], actualizadoEn: '' };
    const ahora = new Date().toISOString();
    const quienEscribe = sesion?.correo ?? 'administración';
    if (typeof cuerpo.comentario === 'string' && cuerpo.comentario.trim()) {
      nota.comentarios = [
        ...nota.comentarios,
        { text: cuerpo.comentario.trim(), at: ahora, by: sesion?.correo }
      ];
      nota = conEvento(nota, {
        at: ahora,
        by: quienEscribe,
        kind: 'comentario',
        text: cuerpo.comentario.trim()
      });
    }
    // "estado" es la forma nueva; "hecho" sigue valiendo para la casilla.
    const estado: TaskStatus | undefined =
      cuerpo.estado &&
      ['pendiente', 'en_progreso', 'bloqueado', 'hecho'].includes(cuerpo.estado)
        ? cuerpo.estado
        : typeof cuerpo.hecho === 'boolean'
          ? cuerpo.hecho
            ? 'hecho'
            : 'pendiente'
          : undefined;
    if (estado) {
      nota.estado = estado;
      nota.hecho = estado === 'hecho';
      nota = conEvento(nota, {
        at: ahora,
        by: quienEscribe,
        kind: 'estado',
        text: `Estado: ${TASK_STATUS_LABEL[estado]}`
      });
      // Los propios guardan el estado en su lugar.
      const propios = datos.personales.leer();
      if (propios.some((t) => t.id === id)) {
        await datos.personales.escribir(
          propios.map((t) =>
            t.id === id ? { ...t, status: estado, updatedAt: ahora } : t
          )
        );
      }
    }
    if (cuerpo.cambios && typeof cuerpo.cambios === 'object') {
      const limpios = limpiarCambios(cuerpo.cambios);
      const resumenCambios = describirCambios(
        limpios,
        cuerpo.tarea ??
          datos.personales.leer().find((t) => t.id === id) ??
          undefined
      );
      if (resumenCambios) {
        nota = conEvento(nota, {
          at: ahora,
          by: quienEscribe,
          kind: 'edicion',
          text: resumenCambios
        });
      }
      // Una correccion a un pendiente de correo enseña al puente para la
      // proxima vez que escriba ese remitente.
      const original = Object.values(datos.registroCorreo.leer())
        .flat()
        .find((t) => t.id === id);
      if (original) {
        await datos.aprendido.escribir(
          aprender(datos.aprendido.leer(), original, limpios)
        );
      }
      // Los propios se editan en su lugar; los demas llevan el cambio encima.
      const propios = datos.personales.leer();
      if (propios.some((t) => t.id === id)) {
        await datos.personales.escribir(
          propios.map((t) =>
            t.id === id
              ? conPrioridadPersonal({ ...t, ...limpios, updatedAt: ahora })
              : t
          )
        );
      } else {
        nota.cambios = { ...(nota.cambios ?? {}), ...limpios };
      }
    }
    if (cuerpo.eliminar === true) {
      // Un pendiente propio se borra de verdad; los demas se esconden.
      nota.eliminado = true;
      nota.hecho = true;
      nota = conEvento(nota, {
        at: ahora,
        by: quienEscribe,
        kind: 'eliminado',
        text: 'Eliminado'
      });
      await datos.personales.escribir(
        datos.personales.leer().filter((t) => t.id !== id)
      );
    }
    nota.actualizadoEn = ahora;
    // Hecho y eliminado aplican a todo el grupo: el mismo correo en otro
    // buzon y los avisos anteriores del mismo remitente.
    const grupo = idsDelGrupo(
      id,
      Object.values(datos.registroCorreo.leer()).flat()
    );
    const conGrupo = { ...todas, [id]: nota };
    for (const otro of grupo.filter((x) => x !== id)) {
      const previa = conGrupo[otro] ?? { comentarios: [], actualizadoEn: '' };
      conGrupo[otro] = {
        ...previa,
        hecho: nota.hecho ?? previa.hecho,
        estado: nota.estado ?? previa.estado,
        eliminado: nota.eliminado ?? previa.eliminado,
        actualizadoEn: ahora
      };
    }
    await datos.anotaciones.escribir(conGrupo);
    let aviso: string | undefined;
    if (cuerpo.asignarA !== undefined) {
      const quien = (cuerpo.asignarA ?? '').trim();
      if (!quien) {
        const actual = datos.anotaciones.leer();
        await datos.anotaciones.escribir({
          ...actual,
          [id]: conEvento(
            {
              ...(actual[id] ?? nota),
              asignado: undefined,
              actualizadoEn: ahora
            },
            {
              at: ahora,
              by: quienEscribe,
              kind: 'asignacion',
              text: 'Sin asignar'
            }
          )
        });
      } else {
        aviso = await asignarPendiente(id, quien, cuerpo.tarea ?? {}, sesion);
      }
    }
    cache.olvidar();
    return { ok: true, anotacion: datos.anotaciones.leer()[id], aviso };
  });

  // --- Inteligencia artificial: fuentes del tablero y rutas /ia ---
  //
  // El tablero se arma aqui, con las mismas funciones que sirven cada ruta,
  // para que el resumen del dia y el correo semanal vean lo mismo que el
  // portal. Cada fuente es tolerante: la que no este configurada da vacio.

  const buzonesLegibles = () =>
    buzones_(cfg(), almacenCorreo).map((cuenta) => ({
      cuenta,
      metodo: metodoDe(cuenta, cfg())
    }));

  const porBuzon = async <T>(
    parte: 'licencias' | 'pendientes' | 'juntas',
    tipo: TipoIngesta
  ): Promise<T[]> => {
    const salida: T[] = [];
    for (const { cuenta, metodo } of buzonesLegibles()) {
      try {
        if (metodo === 'graph' || metodo === 'imap') {
          // Sin esperar la primera lectura: los pendientes salen del
          // registro mientras el buzon se lee atras (ver leidoSinEsperar).
          salida.push(...((await leidoSinEsperar(cuenta, parte)) as T[]));
        } else if (metodo === 'envio') {
          salida.push(...(recibidoDe(cuenta, tipo) as T[]));
        }
      } catch (error) {
        console.warn(
          `[puente] tablero: sin ${parte} de "${cuenta.id}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return salida;
  };

  const siHay = async <T>(hay: unknown, f: () => Promise<T[]>): Promise<T[]> =>
    hay ? f() : [];

  const fuentes: Fuentes = {
    pendientes: async () => {
      const correo = Object.values(
        homologarPendientes(
          Object.fromEntries(
            (await porBuzon<TaskItem>('pendientes', 'pendientes')).reduce(
              (m, t) => m.set(t.accountId, [...(m.get(t.accountId) ?? []), t]),
              new Map<string, TaskItem[]>()
            )
          )
        )
      ).flat();
      const odooTareas = await siHay(cfg().odoo, async () =>
        actividadesComoPendientes(
          (await odoo()).actividades,
          (cfg().odoo as ConfiguracionOdoo).accountId
        )
      ).catch(() => [] as TaskItem[]);
      // Lo personal no es del negocio: no entra al resumen ni al correo del
      // equipo.
      return conNotas([
        ...aplicarAprendido(
          conRemitente(correo, await equipoCompleto()),
          datos.aprendido.leer()
        ),
        ...datos.personales.leer().filter((t) => !t.personal),
        ...pendientesOps(),
        ...odooTareas
      ]);
    },
    juntas: () => porBuzon<Meeting>('juntas', 'juntas'),
    licencias: async () => [
      ...(await porBuzon<LicenseUsage>('licencias', 'licencias')),
      ...dominiosComoLicencias(datos.dominios.leer(), 'dominios'),
      ...(await siHay(cfg().anthropic, () =>
        cache.obtener('licencias:anthropic', ttl.licencias, () =>
          licenciasAnthropic(exigir(cfg().anthropic, 'anthropic'))
        )
      ).catch(() => [])),
      ...(await siHay(cfg().cursor, () =>
        cache.obtener('licencias:cursor', ttl.licencias, () =>
          licenciasCursor(exigir(cfg().cursor, 'cursor'))
        )
      ).catch(() => [])),
      ...(await siHay(cfg().figma, () =>
        cache.obtener('licencias:figma', ttl.licencias, () =>
          licenciasFigma(exigir(cfg().figma, 'figma'))
        )
      ).catch(() => [])),
      ...(await siHay(cfg().ia, () =>
        cache.obtener('licencias:openrouter', ttl.licencias, () =>
          consumoOpenRouter(exigir(cfg().ia, 'openrouter'))
        )
      ).catch(() => [])),
      ...(cfg().vercel
        ? licenciasVercel(cfg().vercel as ConfiguracionVercel)
        : [])
    ],
    dominios: () => datos.dominios.leer(),
    monitoreo: () =>
      siHay(cfg().monitoreo, () =>
        cache.obtener('monitoreo:destinos', ttl.monitoreo, () =>
          destinosMonitoreados(
            exigir(cfg().monitoreo, 'monitoreo'),
            datos.monitoreoHistorial
          )
        )
      ),
    despliegues: () =>
      siHay(cfg().vercel, () =>
        cache.obtener('vercel:despliegues', ttl.despliegues, () =>
          desplieguesVercel(exigir(cfg().vercel, 'vercel'))
        )
      ),
    repos: () =>
      siHay(cfg().github, () =>
        cache.obtener('github:repos', ttl.repos, () =>
          reposGithub(exigir(cfg().github, 'github'))
        )
      ),
    equipo: equipoCompleto
  };

  ia = registrarRutasIa(router, {
    cfg,
    datos,
    exigirAdmin: (contexto) => exigirAdmin(contexto, cfg(), acceso),
    sesionDe: (contexto) => acceso.sesionDe(tokenDe(contexto)),
    olvidarCache: () => cache.olvidar(),
    fuentes,
    pendientesDeCorreo: () =>
      conNotas(Object.values(datos.registroCorreo.leer()).flat()),
    asignar: asignarPendiente,
    dominios: () => datos.dominios.leer(),
    ligaDe,
    push,
    iaPara,
    calendarios: () =>
      buzones_(cfg(), almacenCorreo)
        .filter((c) => metodoDe(c, cfg()) === 'graph')
        .map((c) => ({ id: c.id, usuario: c.usuario })),
    agendar: (cuentaId, junta) => {
      const cuenta = buzon(cuentaId);
      if (metodoDe(cuenta, cfg()) !== 'graph') {
        throw new ErrorConfiguracion(
          `El buzón "${cuentaId}" no está conectado con Microsoft; solo ahí se pueden crear juntas.`
        );
      }
      return crearEventoMicrosoft(cuenta, junta);
    }
  });

  // --- Juntas: crear en el calendario de una cuenta de Microsoft ---

  router.post('/correo/:id/juntas/crear', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuenta = buzon(contexto.segmentos[1] as string);
    if (metodoDe(cuenta, cfg()) !== 'graph') {
      throw new ErrorConfiguracion(
        `El buzón "${cuenta.id}" no está conectado con Microsoft; solo ahí se pueden crear juntas.`
      );
    }
    const j = (contexto.cuerpo ?? {}) as Partial<NuevaJunta>;
    if (!j.titulo || !j.inicio || Number.isNaN(Date.parse(j.inicio))) {
      throw new ErrorPuente('Faltan el título o el inicio de la junta.', 400);
    }
    const fin =
      j.fin && !Number.isNaN(Date.parse(j.fin))
        ? j.fin
        : new Date(Date.parse(j.inicio) + 3_600_000).toISOString();
    const creada = await crearEventoMicrosoft(cuenta, {
      titulo: j.titulo.trim().slice(0, 200),
      inicio: new Date(j.inicio).toISOString(),
      fin,
      lugar: j.lugar,
      cuerpo: j.cuerpo,
      invitados: Array.isArray(j.invitados)
        ? j.invitados.filter(
            (x): x is string => typeof x === 'string' && x.includes('@')
          )
        : [],
      enLinea: j.enLinea === true
    });
    cache.olvidar(`correo:${cuenta.id}`);
    return { ok: true, ...creada };
  });

  // --- Fireflies: notas de juntas ---

  router.get('/fireflies/transcripciones', async () =>
    cfg().fireflies
      ? cache.obtener('fireflies:lista', 300, () =>
          transcripcionesRecientes(
            cfg().fireflies as ConfiguracionFireflies,
            45
          )
        )
      : []
  );

  // Cada junta que Fireflies transcribe se vuelve pendientes (uno por
  // acuerdo, agrupados por el nombre de la junta), una sola vez por
  // transcripcion. Corre solo cada 15 min; /fireflies/procesar lo fuerza.
  const procesarTranscripcion = async (
    id: string,
    ahora = new Date()
  ): Promise<{ titulo: string; pendientes: number }> => {
    const fireflies = cfg().fireflies;
    if (!fireflies) {
      throw new ErrorConfiguracion(
        'Falta la API key de Fireflies (Agenda → Configuración).'
      );
    }
    const completa = await transcripcion(fireflies, id);
    const equipo = await equipoCompleto();
    const nuevos = await pendientesDeTranscripcion(
      iaPara('juntas'),
      completa,
      equipo,
      ahora
    );
    const existentes = new Set(datos.personales.leer().map((t) => t.id));
    const agregar = nuevos.filter((t) => !existentes.has(t.id));
    await datos.personales.escribir([
      ...agregar.map(({ assignee: _a, ...t }) => t),
      ...datos.personales.leer()
    ]);
    for (const t of agregar) {
      if (t.assignee?.email || t.assignee?.id) {
        await asignarPendiente(
          t.id,
          t.assignee.email ?? t.assignee.id,
          t,
          undefined
        ).catch((error) =>
          console.warn(`[puente] Fireflies: ${(error as Error).message}`)
        );
      }
    }
    await datos.firefliesProcesadas.escribir({
      ...datos.firefliesProcesadas.leer(),
      [id]: {
        en: ahora.toISOString(),
        titulo: completa.titulo,
        pendientes: agregar.length
      }
    });
    if (agregar.length > 0) {
      cache.olvidar();
      void push.avisar({
        titulo: `Junta: ${completa.titulo}`,
        cuerpo: `${agregar.length} ${agregar.length === 1 ? 'acuerdo registrado' : 'acuerdos registrados'} como pendientes.`,
        url: '/pendientes',
        etiqueta: `fireflies:${id}`
      });
    }
    return { titulo: completa.titulo, pendientes: agregar.length };
  };

  router.get('/fireflies/estado', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    return datos.firefliesProcesadas.leer();
  });

  router.post('/fireflies/procesar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { id } = (contexto.cuerpo ?? {}) as { id?: string };
    if (typeof id !== 'string' || !id) {
      throw new ErrorPuente('Falta el id de la transcripción.', 400);
    }
    return procesarTranscripcion(id);
  });

  programables.push({
    nombre: 'juntas de Fireflies',
    cadaMinutos: 15,
    correr: async () => {
      const fireflies = cfg().fireflies;
      if (!fireflies) {
        return;
      }
      const procesadas = datos.firefliesProcesadas.leer();
      const recientes = await transcripcionesRecientes(fireflies, 3, 20);
      for (const t of recientes) {
        if (procesadas[t.id] || !t.acuerdos) {
          continue;
        }
        try {
          const r = await procesarTranscripcion(t.id);
          console.log(
            `[puente] junta "${r.titulo}": ${r.pendientes} pendientes desde Fireflies`
          );
        } catch (error) {
          console.warn(
            `[puente] Fireflies "${t.titulo}": ${(error as Error).message}`
          );
        }
      }
    }
  });

  // --- Telegram: dictar por chat ---
  //
  // Publica (Telegram no tiene sesion): se identifica con el secreto del
  // webhook y solo atiende chats autorizados. Un chat desconocido recibe su
  // id para que lo autoricen desde Equipo → Configuración.

  router.post('/telegram/webhook', async (contexto) => {
    const telegram = cfg().telegram;
    if (!telegram) {
      return { ok: true };
    }
    if (
      contexto.encabezados['x-telegram-bot-api-secret-token'] !==
      telegram.secreto
    ) {
      throw new ErrorPuente('Webhook no reconocido.', 403);
    }
    const mensaje = leerUpdate(contexto.cuerpo);
    if (!mensaje) {
      return { ok: true };
    }
    const contestar = (texto: string) =>
      responder(telegram, mensaje.chatId, texto).catch((error) =>
        console.warn(`[puente] telegram: ${(error as Error).message}`)
      );
    if (!telegram.chats.includes(mensaje.chatId)) {
      await contestar(
        `Hola${mensaje.nombre ? ` ${mensaje.nombre}` : ''}. Este chat no está autorizado. Tu id es <code>${mensaje.chatId}</code>: agrégalo en DS Monitor → Equipo → Configuración → Telegram.`
      );
      return { ok: true };
    }
    // Nota de voz: se baja y se transcribe con la IA; de ahi sigue igual que
    // el texto.
    let dictado = mensaje.texto;
    if (!dictado && mensaje.voz) {
      const iaConfig = cfg().ia;
      if (!iaConfig) {
        await contestar(
          'Para transcribir audios hace falta la IA activa; mándame el pendiente escrito.'
        );
        return { ok: true };
      }
      try {
        dictado = await transcribir(
          iaConfig,
          await bajarArchivo(telegram, mensaje.voz),
          'ogg'
        );
        await contestar(`Escuché: <i>${escapar(dictado)}</i>`);
      } catch (error) {
        await contestar(
          `No pude transcribir el audio: ${escapar((error as Error).message)}. Mándalo escrito.`
        );
        return { ok: true };
      }
    }
    if (!dictado) {
      await contestar(
        'Mándame texto o una nota de voz con lo que hay que hacer.'
      );
      return { ok: true };
    }
    mensaje.texto = dictado;
    if (/^\/start/.test(mensaje.texto)) {
      await contestar(
        'Listo. Escríbeme los pendientes tal cual los dictarías: "Junta con Felipe el lunes a las 12 en Italian Coffee, es de OperativAI. Y que Efrén revise el alta de proveedores de Vanguardia, urgente."\n\n' +
          TEXTO_AYUDA
      );
      return { ok: true };
    }
    // Consultas: /hoy, /pendientes, /servicios, ?pregunta. Lo demas es dictado.
    const comando = interpretarComando(mensaje.texto);
    if (comando) {
      try {
        const ahora = new Date();
        if (comando.tipo === 'ayuda') {
          await contestar(TEXTO_AYUDA);
        } else if (comando.tipo === 'hoy') {
          await contestar(textoHoy(await armarTablero(fuentes, ahora), ahora));
        } else if (comando.tipo === 'pendientes') {
          await contestar(
            textoPendientes(await armarTablero(fuentes, ahora), ahora)
          );
        } else if (comando.tipo === 'servicios') {
          await contestar(
            textoServicios(
              listarEjecuciones(datos.ejecuciones.leer(), ahora),
              cfg().monitoreo
                ? await fuentes.monitoreo().catch(() => [] as MonitorTarget[])
                : [],
              ahora
            )
          );
        } else if (comando.tipo === 'pregunta') {
          if (!ia) {
            await contestar('La IA no está activa.');
          } else {
            await contestar(escapar(await ia.preguntar(comando.texto)));
          }
        }
      } catch (error) {
        await contestar(
          `No pude contestar: ${escapar((error as Error).message)}`
        );
      }
      return { ok: true };
    }
    try {
      const equipo = await equipoCompleto();
      const propuestas = await interpretarDictado(
        iaPara('dictado'),
        mensaje.texto,
        equipo
      );
      if (propuestas.length === 0) {
        await contestar('No encontré nada que convertir en pendiente.');
        return { ok: true };
      }
      const ahora = new Date().toISOString();
      const nuevos: TaskItem[] = propuestas.map((p, i) => ({
        id: `local-telegram-${Date.now()}-${i}`,
        title: p.titulo.slice(0, 120),
        description: p.descripcion,
        status: 'pendiente',
        priority: p.prioridad,
        dueDate: p.venceEn,
        dueHasTime: p.conHora === true ? true : undefined,
        accountId: 'mios',
        origin: 'local',
        project: p.proyecto,
        company: p.personal ? undefined : p.empresa,
        personal: p.personal ? true : undefined,
        tags: ['dictado', 'telegram'],
        updatedAt: ahora
      }));
      await datos.personales.escribir([
        ...nuevos.map(conPrioridadPersonal),
        ...datos.personales.leer()
      ]);
      const lineas: string[] = [];
      for (const [i, p] of propuestas.entries()) {
        const t = nuevos[i] as TaskItem;
        let extra = '';
        if (p.persona?.email || p.persona?.id) {
          const aviso = await asignarPendiente(
            t.id,
            p.persona.email ?? p.persona.id,
            t,
            undefined
          ).catch((error) => (error as Error).message);
          extra = ` → ${p.persona.name}${aviso?.includes('avisó') ? ' ✉️' : ''}`;
        }
        lineas.push(
          `• <b>${escapar(t.title)}</b>${t.company ? ` · ${t.company}` : ''}${t.personal ? ' · personal' : ''}${t.dueDate ? ` · ${new Date(t.dueDate).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' })}` : ''} · ${t.priority}${extra}`
        );
      }
      cache.olvidar();
      await contestar(
        `Agregué ${nuevos.length}:\n${lineas.join('\n')}\n\nRevísalos en ${cfg().urlPortal}/pendientes`
      );
    } catch (error) {
      await contestar(`No pude procesarlo: ${(error as Error).message}`);
    }
    return { ok: true };
  });

  // Releer los buzones cada tanto, sin que nadie abra el portal: asi los
  // pendientes nuevos se registran (y la IA los clasifica) a su hora.
  programables.push(
    {
      nombre: 'buzones',
      cadaMinutos: configInicial.refrescoCorreoMinutos,
      correr: async () => {
        for (const { cuenta, metodo } of buzonesLegibles()) {
          if (metodo !== 'graph' && metodo !== 'imap') {
            continue;
          }
          cache.olvidar(`correo:${cuenta.id}`);
          try {
            const lectura = await leido(cuenta);
            console.log(
              `[puente] buzón "${cuenta.id}": ${lectura.leidos} correos, ${lectura.pendientes.length} pendientes registrados`
            );
          } catch (error) {
            console.warn(
              `[puente] buzón "${cuenta.id}" no se pudo releer: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      }
    },
    ...ia.programables
  );

  // --- Mis pendientes: la liga personal de cada quien del equipo ---
  //
  // Sin sesion: el token de la liga identifica a la persona. Solo ve y toca
  // lo que tiene asignado.

  const personaDeLiga = async (
    token: string
  ): Promise<Person & { soloTarea?: string }> => {
    const liga = datos.ligasEquipo.leer()[token];
    if (!liga) {
      throw new ErrorPuente('Esta liga no es válida.', 404);
    }
    if (Date.parse(liga.vence) < Date.now()) {
      throw new ErrorPuente(
        liga.tarea
          ? 'Esta liga venció (sirve hasta el final del día en que se mandó). Te llega otra con la solicitud de estatus, o pídela a quien te asignó el pendiente.'
          : 'Esta liga venció (sirve hasta las 3 de la tarde del día en que se mandó). Pide una nueva a quien te asignó el pendiente.',
        410
      );
    }
    const persona = (await equipoCompleto()).find((p) => p.id === liga.persona);
    if (!persona) {
      throw new ErrorPuente('Esta liga ya no es válida.', 404);
    }
    return liga.tarea ? { ...persona, soloTarea: liga.tarea } : persona;
  };

  const pendientesDe = async (
    persona: Person & { soloTarea?: string }
  ): Promise<TaskItem[]> => {
    const correo = persona.email?.toLowerCase();
    return (await fuentes.pendientes()).filter(
      (t) =>
        t.assignee &&
        (t.assignee.id === persona.id ||
          (correo && t.assignee.email?.toLowerCase() === correo)) &&
        (!persona.soloTarea || t.id === persona.soloTarea)
    );
  };

  // La liga de alguien, a pedido: para copiarla (WhatsApp) o mandarla por
  // correo. Vence a las tres de la tarde como todas.
  router.post('/equipo/:id/liga', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const id = contexto.segmentos[1] as string;
    const persona = (await equipoCompleto()).find((p) => p.id === id);
    if (!persona) {
      throw new ErrorPuente('No hay nadie con ese id en el equipo.', 404);
    }
    const { enviar } = (contexto.cuerpo ?? {}) as { enviar?: boolean };
    const url = await ligaDe(persona);
    const vence = proximasTres(new Date());
    let aviso: string | undefined;
    if (enviar === true) {
      const config = cfg();
      if (!persona.email) {
        aviso = 'Esa persona no tiene correo; copia la liga y mándasela.';
      } else if (!config.acceso) {
        aviso =
          'Sin acceso (EmailJS) no se puede mandar por correo; copia la liga.';
      } else {
        const mias = (await pendientesDe(persona)).filter(
          (t) => t.status !== 'hecho'
        );
        await enviarPorEmailJs(config.acceso, persona.email, '', false, {
          titulo: `Tus pendientes en DS Monitor · ${mias.length}`,
          html:
            `<p>Hola ${escapar(persona.name.split(' ')[0] ?? persona.name)}, aquí puedes ver tus pendientes, cambiar su estado y dejar comentarios:</p>` +
            `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#04202B;color:#fff;text-decoration:none;border-radius:6px">Abrir mis pendientes</a></p>` +
            `<p style="color:#666;font-size:12px">La liga es personal y sirve hasta las 3 de la tarde de hoy.</p>`
        });
        aviso = `Liga enviada a ${persona.email}.`;
      }
    }
    return { url, vence, aviso };
  });

  router.get('/mio/:token/tasks', async ({ segmentos }) => {
    const persona = await personaDeLiga(segmentos[1] as string);
    return {
      persona: { id: persona.id, name: persona.name, role: persona.role },
      /** "tarea": la liga del correo de asignacion; "todos": la de estatus. */
      alcance: persona.soloTarea ? 'tarea' : 'todos',
      pendientes: await pendientesDe(persona)
    };
  });

  router.post('/mio/:token/anotar', async (contexto) => {
    const persona = await personaDeLiga(contexto.segmentos[1] as string);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      id?: string;
      comentario?: string;
      hecho?: boolean;
      estado?: TaskStatus;
    };
    if (
      cuerpo.estado &&
      ['pendiente', 'en_progreso', 'bloqueado', 'hecho'].includes(cuerpo.estado)
    ) {
      cuerpo.hecho = cuerpo.estado === 'hecho';
    }
    const id = (cuerpo.id ?? '').trim();
    const mias = await pendientesDe(persona);
    if (!id || !mias.some((t) => t.id === id)) {
      throw new ErrorPuente('Ese pendiente no está a tu nombre.', 403);
    }
    const todas = datos.anotaciones.leer();
    let nota: Anotacion = todas[id] ?? { comentarios: [], actualizadoEn: '' };
    const ahora = new Date().toISOString();
    if (typeof cuerpo.comentario === 'string' && cuerpo.comentario.trim()) {
      nota.comentarios = [
        ...nota.comentarios,
        { text: cuerpo.comentario.trim(), at: ahora, by: persona.name }
      ];
      nota = conEvento(nota, {
        at: ahora,
        by: persona.name,
        kind: 'comentario',
        text: cuerpo.comentario.trim()
      });
    }
    if (typeof cuerpo.hecho === 'boolean') {
      const estado: TaskStatus =
        cuerpo.estado ?? (cuerpo.hecho ? 'hecho' : 'pendiente');
      nota.hecho = estado === 'hecho';
      nota.estado = estado;
      nota = conEvento(nota, {
        at: ahora,
        by: persona.name,
        kind: 'estado',
        text: `Estado: ${TASK_STATUS_LABEL[estado]}`
      });
    }
    nota.actualizadoEn = ahora;
    await datos.anotaciones.escribir({ ...todas, [id]: nota });
    cache.olvidar();
    // Quien asigna se entera: aviso en el monitor y push.
    const tarea = mias.find((t) => t.id === id) as TaskItem;
    const accion =
      cuerpo.hecho === true
        ? 'terminó'
        : cuerpo.hecho === false
          ? cuerpo.estado && cuerpo.estado !== 'pendiente'
            ? `puso ${TASK_STATUS_LABEL[cuerpo.estado].toLowerCase()}`
            : 'reabrió'
          : 'comentó';
    const aviso: Aviso = {
      id: randomBytes(8).toString('hex'),
      tipo:
        cuerpo.hecho === true
          ? 'termino'
          : cuerpo.hecho === false
            ? 'reabrio'
            : 'comento',
      accion,
      persona: persona.name,
      tareaId: id,
      titulo: tarea.title,
      texto:
        typeof cuerpo.comentario === 'string'
          ? cuerpo.comentario.trim().slice(0, 200)
          : undefined,
      en: ahora,
      leido: false
    };
    await datos.avisos.escribir([aviso, ...datos.avisos.leer()].slice(0, 200));
    void push.avisar({
      titulo: `${persona.name} ${accion} ${tarea.title}`,
      cuerpo:
        typeof cuerpo.comentario === 'string'
          ? cuerpo.comentario.slice(0, 140)
          : '',
      url: `/pendientes?abrir=${encodeURIComponent(id)}`,
      etiqueta: `mio:${id}`
    });
    return { ok: true, anotacion: nota };
  });

  // Desde su liga, alguien pide que le quiten un pendiente (no tiene tiempo).
  // Queda marcado en el pendiente y a Carlos le llega el aviso para decidir.
  router.post('/mio/:token/reasignar', async (contexto) => {
    const persona = await personaDeLiga(contexto.segmentos[1] as string);
    const cuerpo = (contexto.cuerpo ?? {}) as { id?: string; motivo?: string };
    const id = (cuerpo.id ?? '').trim();
    const mias = await pendientesDe(persona);
    const tarea = mias.find((t) => t.id === id);
    if (!tarea) {
      throw new ErrorPuente('Ese pendiente no está a tu nombre.', 403);
    }
    const motivo =
      typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim()
        ? cuerpo.motivo.trim().slice(0, 300)
        : undefined;
    const ahora = new Date().toISOString();
    const todas = datos.anotaciones.leer();
    let nota: Anotacion = todas[id] ?? { comentarios: [], actualizadoEn: '' };
    nota.solicitudReasignacion = {
      by: persona.name,
      reason: motivo,
      at: ahora
    };
    nota = conEvento(nota, {
      at: ahora,
      by: persona.name,
      kind: 'solicitud',
      text: `Pidió que se reasigne${motivo ? `: ${motivo}` : ''}`
    });
    nota.actualizadoEn = ahora;
    await datos.anotaciones.escribir({ ...todas, [id]: nota });
    cache.olvidar();
    const aviso: Aviso = {
      id: randomBytes(8).toString('hex'),
      tipo: 'reasignacion',
      accion: 'pide reasignar',
      persona: persona.name,
      tareaId: id,
      titulo: tarea.title,
      texto: motivo,
      en: ahora,
      leido: false
    };
    await datos.avisos.escribir([aviso, ...datos.avisos.leer()].slice(0, 200));
    void push.avisar({
      titulo: `${persona.name} pide reasignar: ${tarea.title}`,
      cuerpo: motivo ?? 'Sin motivo',
      url: `/pendientes?abrir=${encodeURIComponent(id)}`,
      etiqueta: `reasignar:${id}`
    });
    return { ok: true };
  });

  // Carlos decide desde el portal: aprobar (y a quien) o rechazar. En los
  // dos casos la persona se entera por correo, si hay con que mandarlo.
  router.post('/pendientes/reasignacion', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      id?: string;
      decision?: 'aprobar' | 'rechazar';
      asignarA?: string;
      nota?: string;
      tarea?: Partial<TaskItem>;
    };
    const id = (cuerpo.id ?? '').trim();
    const todas = datos.anotaciones.leer();
    const nota0 = todas[id];
    if (!id || !nota0?.solicitudReasignacion) {
      throw new ErrorPuente(
        'Ese pendiente no tiene solicitud de reasignación.',
        404
      );
    }
    const solicitud = nota0.solicitudReasignacion;
    const sesion = acceso.sesionDe(tokenDe(contexto));
    const quien = sesion?.correo ?? 'administración';
    const ahora = new Date().toISOString();
    const comentario =
      typeof cuerpo.nota === 'string' && cuerpo.nota.trim()
        ? cuerpo.nota.trim().slice(0, 300)
        : undefined;
    const solicitante = (await equipoCompleto()).find(
      (p) => p.name === solicitud.by
    );
    const titulo = cuerpo.tarea?.title ?? id;
    if (cuerpo.decision === 'aprobar') {
      if (!cuerpo.asignarA) {
        throw new ErrorPuente('Di a quién se reasigna.', 400);
      }
      let nota = { ...nota0 };
      delete nota.solicitudReasignacion;
      nota = conEvento(nota, {
        at: ahora,
        by: quien,
        kind: 'solicitud',
        text: `Reasignación aprobada${comentario ? `: ${comentario}` : ''}`
      });
      await datos.anotaciones.escribir({ ...todas, [id]: nota });
      const aviso = await asignarPendiente(
        id,
        cuerpo.asignarA,
        cuerpo.tarea ?? {},
        sesion
      );
      if (solicitante?.email && cfg().acceso) {
        await enviarPorEmailJs(
          cfg().acceso as NonNullable<Configuracion['acceso']>,
          solicitante.email,
          '',
          false,
          {
            titulo: `Reasignado: ${titulo}`,
            html:
              `<p>Se aprobó tu solicitud: <strong>${escapar(titulo)}</strong> ya no está a tu nombre.</p>` +
              (comentario ? `<p>${escapar(comentario)}</p>` : '')
          }
        ).catch(() => undefined);
      }
      return { ok: true, aviso };
    }
    if (cuerpo.decision === 'rechazar') {
      let nota = { ...nota0 };
      delete nota.solicitudReasignacion;
      nota = conEvento(nota, {
        at: ahora,
        by: quien,
        kind: 'solicitud',
        text: `Reasignación rechazada${comentario ? `: ${comentario}` : ''}`
      });
      nota.actualizadoEn = ahora;
      await datos.anotaciones.escribir({ ...todas, [id]: nota });
      cache.olvidar();
      if (solicitante?.email && cfg().acceso) {
        await enviarPorEmailJs(
          cfg().acceso as NonNullable<Configuracion['acceso']>,
          solicitante.email,
          '',
          false,
          {
            titulo: `Sigue a tu nombre: ${titulo}`,
            html:
              `<p>Tu solicitud de reasignar <strong>${escapar(titulo)}</strong> no se aprobó; sigue a tu nombre.</p>` +
              (comentario ? `<p>${escapar(comentario)}</p>` : '') +
              `<p style="color:#666;font-size:12px">Con la liga de la solicitud de estatus puedes dejar en qué va.</p>`
          }
        ).catch(() => undefined);
        return {
          ok: true,
          aviso: `Rechazada; se avisó a ${solicitante.email}.`
        };
      }
      return { ok: true, aviso: 'Rechazada.' };
    }
    throw new ErrorPuente('La decisión debe ser "aprobar" o "rechazar".', 400);
  });

  // --- Avisos del monitor: lo que el equipo movio ---

  router.get('/avisos', async () => datos.avisos.leer());

  router.post('/avisos/leer', async (contexto) => {
    const { ids } = (contexto.cuerpo ?? {}) as { ids?: string[] };
    const marcar = Array.isArray(ids) ? new Set(ids) : undefined;
    await datos.avisos.escribir(
      datos.avisos
        .leer()
        .map((a) => (!marcar || marcar.has(a.id) ? { ...a, leido: true } : a))
    );
    return { ok: true };
  });

  // --- Solicitar estatus: correo a cada quien con lo suyo y su liga ---

  const solicitarEstatus = async (
    ids?: string[]
  ): Promise<{ enviados: string[]; errores: string[] }> => {
    const config = cfg();
    if (!config.acceso) {
      throw new ErrorConfiguracion(
        'Para pedir estatus hace falta el acceso (EmailJS) en Equipo → Configuración.'
      );
    }
    const equipo = (await equipoCompleto()).filter(
      (p) => p.email && (ids ? ids.includes(p.id) : p.pedirEstatus)
    );
    const enviados: string[] = [];
    const errores: string[] = [];
    for (const persona of equipo) {
      const mias = (await pendientesDe(persona)).filter(
        (t) => t.status !== 'hecho'
      );
      if (mias.length === 0) {
        continue;
      }
      const liga = await ligaDe(persona);
      const html =
        `<p>Hola ${escapar(persona.name.split(' ')[0] ?? persona.name)}, ¿cómo van estos pendientes? Marca los que ya terminaste y deja un comentario en los que siguen:</p>` +
        `<ul>${mias
          .map(
            (t) =>
              `<li><strong>${escapar(t.title)}</strong>${t.company ? ` · ${escapar(t.company)}` : ''}${t.project ? ` · ${escapar(t.project)}` : ''}${t.dueDate ? ` · vence ${new Date(t.dueDate).toLocaleDateString('es-MX', { dateStyle: 'medium', timeZone: 'America/Mexico_City' })}` : ''}</li>`
          )
          .join('')}</ul>` +
        `<p><a href="${liga}" style="display:inline-block;padding:10px 16px;background:#04202B;color:#fff;text-decoration:none;border-radius:6px">Actualizar mis pendientes</a></p>` +
        `<p style="color:#666;font-size:12px">La liga sirve hasta las 3 de la tarde de hoy.</p>`;
      try {
        await enviarPorEmailJs(
          config.acceso,
          persona.email as string,
          '',
          false,
          {
            titulo: `Estatus de tus pendientes · ${mias.length}`,
            html
          }
        );
        enviados.push(persona.email as string);
      } catch (error) {
        errores.push(`${persona.email}: ${(error as Error).message}`);
      }
    }
    return { enviados, errores };
  };

  router.post('/equipo/solicitar-estatus', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { ids } = (contexto.cuerpo ?? {}) as { ids?: string[] };
    return solicitarEstatus(
      Array.isArray(ids) && ids.length > 0 ? ids : undefined
    );
  });

  router.get('/equipo/estatus-config', async () => datos.estatusConfig.leer());

  router.post('/equipo/estatus-config', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { dias, hora } = (contexto.cuerpo ?? {}) as {
      dias?: unknown;
      hora?: unknown;
    };
    const limpiosDias = Array.isArray(dias)
      ? [
          ...new Set(
            dias
              .map(Number)
              .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          )
        ].sort()
      : datos.estatusConfig.leer().dias;
    const limpiaHora =
      typeof hora === 'number' &&
      Number.isInteger(hora) &&
      hora >= 0 &&
      hora <= 23
        ? hora
        : datos.estatusConfig.leer().hora;
    return datos.estatusConfig.escribir({
      dias: limpiosDias,
      hora: limpiaHora
    });
  });

  // Los dias y a la hora configurados, a quien tenga la marca "pedir estatus".
  programables.push({
    nombre: 'solicitud de estatus',
    cadaMinutos: 15,
    correr: async () => {
      const ahora = new Date();
      const local = new Date(
        ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
      );
      const dia = local.toISOString().slice(0, 10);
      const programa = datos.estatusConfig.leer();
      if (
        !programa.dias.includes(local.getDay()) ||
        local.getHours() < programa.hora
      ) {
        return;
      }
      if (datos.estatusPedido.leer().dia === dia || !cfg().acceso) {
        return;
      }
      const marcados = (await equipoCompleto()).some(
        (p) => p.pedirEstatus && p.email
      );
      await datos.estatusPedido.escribir({ dia });
      if (!marcados) {
        return;
      }
      const r = await solicitarEstatus();
      console.log(
        `[puente] estatus pedido a ${r.enviados.length}${r.errores.length ? `, ${r.errores.length} con error` : ''}`
      );
    }
  });

  // --- Avisos push al celular ---

  router.get('/push/clave', async () => ({ clave: await push.clavePublica() }));

  router.post('/push/suscribir', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { endpoint } = (contexto.cuerpo ?? {}) as { endpoint?: string };
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) {
      throw new ErrorPuente('Falta el endpoint de la suscripción.', 400);
    }
    const sesion = acceso.sesionDe(tokenDe(contexto));
    const sub = await push.suscribir(
      endpoint,
      sesion?.correo,
      contexto.encabezados['user-agent']?.slice(0, 120)
    );
    return { ok: true, id: sub.id, correo: sub.correo };
  });

  router.post('/push/olvidar', async (contexto) => {
    const { endpoint } = (contexto.cuerpo ?? {}) as { endpoint?: string };
    if (typeof endpoint === 'string') {
      await push.olvidar(endpoint);
    }
    return { ok: true };
  });

  router.post('/push/pendientes', async (contexto) => {
    const { endpoint } = (contexto.cuerpo ?? {}) as { endpoint?: string };
    return typeof endpoint === 'string' ? push.recoger(endpoint) : [];
  });

  router.get('/push/estado', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    return {
      dispositivos: push.lista().map((s) => ({
        id: s.id,
        correo: s.correo,
        agente: s.agente,
        creadoEn: s.creadoEn,
        ultimoEnvio: s.ultimoEnvio
      }))
    };
  });

  router.post('/push/probar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const sesion = acceso.sesionDe(tokenDe(contexto));
    const r = await push.avisar(
      {
        titulo: 'DS Monitor',
        cuerpo: 'Los avisos en este dispositivo funcionan.',
        url: '/hoy',
        etiqueta: 'prueba'
      },
      sesion?.correo
    );
    return {
      ok: r.enviados > 0,
      mensaje:
        r.enviados > 0
          ? `Aviso mandado a ${r.enviados} dispositivo(s).`
          : `No se pudo mandar: ${r.errores.join('; ') || 'no hay dispositivos suscritos con tu correo'}.`
    };
  });

  // Lo que se avisa solo: pendientes que vencen hoy (a su responsable, o a
  // todos si no tiene) y sitios caidos (a todos). Cada cosa se avisa una vez.
  programables.push({
    nombre: 'avisos push',
    cadaMinutos: 15,
    correr: async () => {
      if (push.lista().length === 0) {
        return;
      }
      const ahora = new Date();
      const avisados = { ...datos.pushAvisados.leer() };
      const hoy = ahora.toLocaleDateString('en-CA', {
        timeZone: 'America/Mexico_City'
      });
      const hora = Number(
        ahora.toLocaleTimeString('en-GB', {
          timeZone: 'America/Mexico_City',
          hour: '2-digit',
          hour12: false
        })
      );
      let cambio = false;
      if (hora >= 7) {
        const pendientes = await fuentes
          .pendientes()
          .catch(() => [] as TaskItem[]);
        for (const t of pendientes) {
          if (t.status === 'hecho' || !t.dueDate) {
            continue;
          }
          const dia = new Date(t.dueDate).toLocaleDateString('en-CA', {
            timeZone: 'America/Mexico_City'
          });
          const clave = `vence:${t.id}:${dia}`;
          if (dia !== hoy || avisados[clave]) {
            continue;
          }
          await push.avisar(
            {
              titulo: `Vence hoy: ${t.title}`,
              cuerpo: [t.company, t.project, `prioridad ${t.priority}`]
                .filter((x) => x)
                .join(' · '),
              url: '/pendientes',
              etiqueta: `vence:${t.id}`
            },
            t.assignee?.email
          );
          avisados[clave] = ahora.toISOString();
          cambio = true;
        }
      }
      const monitoreo = await fuentes.monitoreo().catch(() => []);
      for (const m of monitoreo) {
        if (m.status !== 'caido') {
          continue;
        }
        const clave = `caido:${m.id}:${m.lastCheck ?? ''}`;
        if (
          avisados[clave] ||
          Object.keys(avisados).some(
            (k) =>
              k.startsWith(`caido:${m.id}:`) &&
              ahora.getTime() - Date.parse(avisados[k] as string) <
                6 * 3_600_000
          )
        ) {
          continue;
        }
        await push.avisar({
          titulo: `Caído: ${m.name}`,
          cuerpo: m.incident ?? m.url,
          url: '/monitoreo',
          etiqueta: `caido:${m.id}`
        });
        avisados[clave] = ahora.toISOString();
        cambio = true;
      }
      if (cambio) {
        const limite = ahora.getTime() - 7 * 86_400_000;
        await datos.pushAvisados.escribir(
          Object.fromEntries(
            Object.entries(avisados).filter(([, en]) => Date.parse(en) > limite)
          )
        );
      }
    }
  });

  // --- Lo que se recibe en lugar de ir a buscarlo ---

  registrarRutasIngesta(
    router,
    configInicial,
    almacen,
    () => datos.emisores.leer(),
    {
      leer: () => datos.ejecuciones.leer(),
      escribir: (e) => datos.ejecuciones.escribir(e)
    }
  );

  // El propio puente se reporta en Ejecuciones: cada tarea programada deja su
  // corrida (emisor "ds-monitor") al terminar, con duracion y error si lo hubo.
  // Asi, si el barrido de correo o la vigilancia dejan de correr, se ve en la
  // misma pantalla que los demas servicios y avisa por Telegram.
  const conReporte = (tarea: Programable): Programable => ({
    ...tarea,
    correr: async () => {
      const inicio = Date.now();
      let error: unknown;
      try {
        await tarea.correr();
      } catch (e) {
        error = e;
      }
      try {
        const { ejecuciones } = registrarEjecucion(
          datos.ejecuciones.leer(),
          'ds-monitor',
          {
            integracion: tarea.nombre,
            nombre: `Puente: ${tarea.nombre}`,
            estado: error ? 'error' : 'ok',
            mensaje: error
              ? (error instanceof Error ? error.message : String(error)).slice(
                  0,
                  240
                )
              : undefined,
            detalle: error instanceof Error ? error.stack : undefined,
            duracionMs: Date.now() - inicio,
            cadaMinutos: tarea.cadaMinutos
          }
        );
        await datos.ejecuciones.escribir(ejecuciones);
      } catch (e) {
        console.warn(
          `[puente] no se pudo registrar la corrida de "${tarea.nombre}": ${(e as Error).message}`
        );
      }
      if (error) {
        throw error;
      }
    }
  });

  // --- Lo que corrio cada integracion (se lee con sesion) ---

  // Vigilancia por Telegram, a los chats autorizados, una vez por problema y
  // otra cuando vuelve:
  //  - un sitio monitoreado que esta caido;
  //  - una integracion que lleva mas de una hora sin reportar (o mas de su
  //    frecuencia declarada) o cuya ultima corrida fallo.
  const mandarTelegram = async (texto: string): Promise<boolean> => {
    const telegram = cfg().telegram;
    if (!telegram || telegram.chats.length === 0) {
      console.warn(
        '[puente] vigilancia: hay avisos pero Telegram no está configurado'
      );
      return false;
    }
    let mandado = false;
    for (const chat of telegram.chats) {
      try {
        await responder(telegram, chat, texto);
        mandado = true;
      } catch (error) {
        console.warn(
          `[puente] telegram (vigilancia): ${(error as Error).message}`
        );
      }
    }
    if (mandado) {
      console.log(
        `[puente] vigilancia: aviso mandado por Telegram (${texto.split('\n').length - 2} línea(s))`
      );
    }
    return mandado;
  };

  // Lunes a las 8: cuantos pendientes del negocio siguen sin dueño o sin
  // empresa, por Telegram y en la campana, con liga a esa vista. Una vez por
  // semana.
  programables.push({
    nombre: 'sin asignar',
    cadaMinutos: 15,
    correr: async () => {
      const ahora = new Date();
      const local = new Date(
        ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
      );
      const semana = semanaIso(ahora);
      const previo = datos.avisosSemanales.leer();
      if (
        local.getDay() !== 1 ||
        local.getHours() < 8 ||
        previo.sinAsignar === semana
      ) {
        return;
      }
      const abiertos = (await fuentes.pendientes()).filter(
        (t) => t.status !== 'hecho' && !t.personal
      );
      const sinDueno = abiertos.filter((t) => !t.assignee).length;
      const sinEmpresa = abiertos.filter((t) => !t.company).length;
      const porIdentificar = abiertos.filter(
        (t) => t.senderKind === 'por_identificar'
      ).length;
      await datos.avisosSemanales.escribir({ ...previo, sinAsignar: semana });
      if (sinDueno === 0 && sinEmpresa === 0) {
        return;
      }
      const partes = [
        sinDueno > 0 ? `${sinDueno} sin responsable` : undefined,
        sinEmpresa > 0 ? `${sinEmpresa} sin empresa` : undefined,
        porIdentificar > 0
          ? `${porIdentificar} con remitente por identificar`
          : undefined
      ].filter((x): x is string => !!x);
      const texto = `Pendientes por acomodar: ${partes.join(', ')}.`;
      const aviso: Aviso = {
        id: randomBytes(8).toString('hex'),
        tipo: 'sistema',
        accion: 'recuerda',
        persona: 'DS Monitor',
        tareaId: '',
        titulo: texto,
        texto:
          'Abre Pendientes → Sin asignar; en cada tarjeta "Sugerir responsable" te propone a quién.',
        en: ahora.toISOString(),
        leido: false
      };
      await datos.avisos.escribir(
        [aviso, ...datos.avisos.leer()].slice(0, 200)
      );
      await mandarTelegram(
        `<b>DS Monitor · lunes</b>\n${texto}\n${cfg().urlPortal}/pendientes?owner=nadie`
      );
    }
  });

  programables.push({
    nombre: 'vigilancia de servicios',
    cadaMinutos: 5,
    correr: async () => {
      const ahora = new Date();
      const sitios = cfg().monitoreo
        ? await fuentes.monitoreo().catch(() => [] as MonitorTarget[])
        : [];
      const deSitios = avisosDeSitios(
        sitios,
        datos.sitiosAvisados.leer(),
        ahora
      );
      const deEjecuciones = avisosPendientes(
        datos.ejecuciones.leer(),
        datos.ejecucionesAvisadas.leer(),
        ahora
      );
      const lineas = [...deSitios.lineas, ...deEjecuciones.lineas];
      if (lineas.length === 0) {
        return;
      }
      const texto = `<b>DS Monitor · servicios</b>\n${lineas.join('\n')}\n${cfg().urlPortal}/${deSitios.lineas.length > 0 ? 'monitoreo' : 'ejecuciones'}`;
      // Solo se da por avisado lo que de verdad salio; si Telegram fallo se
      // vuelve a intentar en la siguiente vuelta.
      if (await mandarTelegram(texto)) {
        await datos.sitiosAvisados.escribir(deSitios.avisados);
        await datos.ejecucionesAvisadas.escribir(deEjecuciones.avisadas);
      }
    }
  });

  // Restaura el registro de pendientes de correo desde los archivos del disco
  // (la epoca anterior a la base): une lo del archivo con lo que hay, sin
  // pisar lo actual. Sirve si el registro se vacio por un reinicio a medias.
  router.post('/pendientes/correo/restaurar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const archivos = new PersistenciaArchivos({
      datos: configInicial.directorioDatos
    });
    const guardado = (await archivos.leerColeccion('datos')).get(
      'pendientes-correo'
    ) as Registro | undefined;
    if (!guardado) {
      throw new ErrorPuente(
        'No hay archivo pendientes-correo.json en el disco.',
        404
      );
    }
    const actual = datos.registroCorreo.leer();
    const unido: Registro = { ...actual };
    let agregados = 0;
    for (const [cuenta, lista] of Object.entries(guardado)) {
      const ids = new Set((unido[cuenta] ?? []).map((t) => t.id));
      const faltan = lista.filter((t) => !ids.has(t.id));
      unido[cuenta] = [...(unido[cuenta] ?? []), ...faltan];
      agregados += faltan.length;
    }
    await datos.registroCorreo.escribir(unido);
    cache.olvidar();
    return {
      ok: true,
      agregados,
      porCuenta: Object.fromEntries(
        Object.entries(unido).map(([c, l]) => [c, l.length])
      )
    };
  });

  // Restaura un respaldo completo (el JSON que da GET /respaldo) en la
  // persistencia: escribe cada documento. Sirve para mudar el puente de un
  // servidor a otro; despues hay que reiniciar para que las tablas propias
  // se llenen desde los documentos y todo se relea.
  router.post('/respaldo/restaurar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      colecciones?: Record<string, Record<string, unknown>>;
    };
    if (!cuerpo.colecciones || typeof cuerpo.colecciones !== 'object') {
      throw new ErrorPuente('Falta "colecciones" con el respaldo.', 400);
    }
    let escritos = 0;
    for (const c of COLECCIONES) {
      const docs = cuerpo.colecciones[c];
      if (!docs || typeof docs !== 'object') {
        continue;
      }
      for (const [clave, valor] of Object.entries(docs)) {
        await persistencia.guardar(c, clave, valor);
        escritos++;
      }
    }
    // Lo restaurado manda: las tablas propias se reescriben desde los
    // documentos y lo que esta en memoria se recarga, sin esperar a un
    // reinicio (asi ninguna tarea programada pisa el respaldo a medias).
    const docs = new Map(Object.entries(cuerpo.colecciones['datos'] ?? {}));
    for (const a of Object.values(datos) as AlmacenJson<unknown>[]) {
      if (a instanceof AlmacenTabla) {
        if (docs.has(a.clave)) {
          await a.reemplazar(docs.get(a.clave));
        }
      } else {
        a.cargarDe(docs);
      }
    }
    await almacen.cargar();
    await almacenCorreo.cargar();
    if (integraciones) {
      await integraciones.almacen.cargar();
      integraciones.configurador.invalidar();
    }
    cache.olvidar();
    return {
      ok: true,
      escritos,
      aviso: 'Restaurado y cargado; no hace falta reiniciar.'
    };
  });

  // Respaldo completo: todas las colecciones tal como estan en la base, para
  // descargarlo desde Integraciones. Lleva credenciales (buzones,
  // integraciones): es un respaldo de verdad, se guarda con cuidado.
  router.get('/respaldo', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const colecciones: Record<string, Record<string, unknown>> = {};
    for (const c of COLECCIONES) {
      colecciones[c] = Object.fromEntries(await persistencia.leerColeccion(c));
    }
    return {
      generadoEn: new Date().toISOString(),
      origen: persistencia.descripcion,
      colecciones
    };
  });

  router.get('/ejecuciones', async () =>
    listarEjecuciones(datos.ejecuciones.leer())
  );

  router.post('/ejecuciones/borrar', async (contexto) => {
    exigirAdmin(contexto, cfg(), acceso);
    const { clave } = (contexto.cuerpo ?? {}) as { clave?: string };
    const todas = { ...datos.ejecuciones.leer() };
    if (!clave || !todas[clave]) {
      throw new ErrorPuente('No hay una ejecución con esa clave.', 404);
    }
    delete todas[clave];
    await datos.ejecuciones.escribir(todas);
    return { ok: true };
  });

  // Todas las tareas que se apuntaron arriba, ya con su reporte.
  for (let i = 0; i < programables.length; i++) {
    programables[i] = conReporte(programables[i] as Programable);
  }

  return router;
}
