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
  dominiosComoLicencias,
  validarDominio,
  type Dominio
} from '../datos/dominios.js';
import type {
  LicenseUsage,
  Meeting,
  Person,
  TaskItem
} from '../nucleo/contrato.js';
import type { Fuentes } from '../ia/tablero.js';
import { anotar, type Anotaciones } from '../pendientes/anotaciones.js';
import { registrar, type Registro } from '../pendientes/registro.js';
import { enviarPorEmailJs } from '../acceso/acceso.js';
import type {
  ClienteIngesta,
  ConfiguracionOdoo,
  ConfiguracionVercel
} from '../config/entorno.js';
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
  olvidarAcceso,
  quienSoy,
  urlDeAutorizacion
} from '../proveedores/microsoft.js';
import { AlmacenIngesta } from '../ingesta/almacen.js';
import {
  registrarRutasIngesta,
  servirRecibido
} from '../ingesta/rutas-ingesta.js';
import type { TipoIngesta } from '../ingesta/modelos.js';
import { Cache } from '../nucleo/cache.js';
import { ErrorConfiguracion, ErrorPuente } from '../nucleo/errores.js';
import { licenciasAnthropic } from '../proveedores/anthropic.js';
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
import { destinosMonitoreados } from '../proveedores/monitoreo.js';
import {
  desplieguesVercel,
  estadoPlataformaVercel,
  licenciasVercel
} from '../proveedores/vercel.js';
import { Redireccion, Router, type Contexto } from './router.js';
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
  almacenCorreo = new AlmacenCorreo(config.directorioCorreo),
  hayEmisoresOps: () => boolean = () => false
): Estado[] {
  const filas: [string, boolean, string[]][] = [
    ['anthropic', config.anthropic !== undefined, ['licenses']],
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
}

/** Lee todos los almacenes del disco; se llama una vez al arrancar. */
export async function cargarDatos(datos: Datos): Promise<void> {
  await Promise.all(
    Object.values(datos).map((almacen) => (almacen as AlmacenJson<unknown>).cargar())
  );
}

export function abrirDatos(directorio: string): Datos {
  return {
    equipo: new AlmacenJson<Person[]>(join(directorio, 'equipo.json'), []),
    dominios: new AlmacenJson<Dominio[]>(join(directorio, 'dominios.json'), []),
    sesiones: new AlmacenJson<Sesion[]>(join(directorio, 'sesiones.json'), []),
    personales: new AlmacenJson<TaskItem[]>(
      join(directorio, 'personales.json'),
      []
    ),
    emisores: new AlmacenJson<ClienteIngesta[]>(
      join(directorio, 'emisores.json'),
      []
    ),
    anotaciones: new AlmacenJson<Anotaciones>(
      join(directorio, 'anotaciones.json'),
      {}
    ),
    registroCorreo: new AlmacenJson<Registro>(
      join(directorio, 'pendientes-correo.json'),
      {}
    ),
    iaCorreo: new AlmacenJson<Record<string, Clasificacion>>(
      join(directorio, 'ia-correo.json'),
      {}
    ),
    iaResumen: new AlmacenJson(join(directorio, 'ia-resumen.json'), null),
    iaAlertas: new AlmacenJson(join(directorio, 'ia-alertas.json'), {}),
    costosHistorial: new AlmacenJson(
      join(directorio, 'licencias-historial.json'),
      {}
    ),
    iaAcuerdos: new AlmacenJson(join(directorio, 'ia-acuerdos.json'), {}),
    iaCrm: new AlmacenJson(join(directorio, 'ia-crm.json'), {}),
    iaDiagnosticos: new AlmacenJson(
      join(directorio, 'ia-diagnosticos.json'),
      {}
    ),
    iaRepos: new AlmacenJson(join(directorio, 'ia-repos.json'), null),
    iaSemana: new AlmacenJson(join(directorio, 'ia-semana.json'), {}),
    iaPendientes: new AlmacenJson(join(directorio, 'ia-pendientes.json'), {})
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
  almacen = new AlmacenIngesta(configInicial.directorioIngesta),
  almacenCorreo = new AlmacenCorreo(configInicial.directorioCorreo),
  integraciones?: {
    almacen: AlmacenIntegraciones;
    configurador: Configurador;
  },
  datos = abrirDatos(configInicial.directorioDatos),
  /** Donde se apuntan las tareas que corren solas (index.ts las programa). */
  programables: Programable[] = []
): Router {
  const router = new Router();
  const ttl = configInicial.cacheSegundos;
  const acceso = new Acceso(datos.sesiones);
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

  const LIBRES = new Set(['salud', 'acceso', 'ingesta', 'recibido']);
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
    const sesion: Sesion = await acceso.entrar(correo ?? '', codigo ?? '');
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
        e.tipos
          .map((t) => almacen.leer(t as TipoIngesta, e.nombre)?.recibidoEn)
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
    const tipos = (cuerpo.tipos ?? []).filter((t) =>
      [
        'pendientes',
        'equipo',
        'juntas',
        'monitoreo',
        'crm',
        'licencias',
        'despliegues',
        'repos'
      ].includes(t)
    );
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
            : undefined
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
        priority:
          (['baja', 'media', 'alta', 'urgente'] as const).find(
            (p) => p === t['priority']
          ) ?? 'media',
        dueDate: texto(t['dueDate']),
        accountId: 'mios',
        origin: 'local',
        project: texto(t['project']),
        company: texto(t['company']),
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
      destinosMonitoreados(exigir(cfg().monitoreo, 'monitoreo'))
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
    const ia = cfg().ia;
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
    const ia = cfg().ia;
    if (!ia || lectura.paraIa.length === 0) {
      return [];
    }
    const ahora = new Date();
    let resultados: Clasificacion[];
    try {
      resultados = await clasificarCorreos(ia, lectura.paraIa, ahora);
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
      const actual = registrar(
        registro[cuenta.id] ?? [],
        detectados,
        hechos()
      );
      await datos.registroCorreo.escribir({ ...registro, [cuenta.id]: actual });
      return { ...lectura, pendientes: actual };
    });

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
        ? (await leido(cuenta))[parte]
        : recibidoDe(cuenta, tipo);
    return parte === 'pendientes' ? conNotas(lista as TaskItem[]) : lista;
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
    const configurada =
      id === 'acceso'
        ? cfg().acceso !== undefined
        : id === 'microsoft'
          ? cfg().microsoftApp !== undefined
          : id === 'google'
            ? cfg().googleApp !== undefined
            : (estado?.configurada ?? false);
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
      (p) => p.id.toLowerCase() === buscado || p.email?.toLowerCase() === buscado
    );
    if (!persona) {
      throw new ErrorPuente(`No hay nadie en el equipo con "${quien}".`, 400);
    }
    nota.asignado = persona;
    nota.actualizadoEn = new Date().toISOString();
    await datos.anotaciones.escribir({ ...todas, [id]: nota });
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
      (t.dueDate ? ` · Vence: ${new Date(t.dueDate).toLocaleDateString('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' })}` : '') +
      (t.project ? ` · Proyecto: ${escapar(t.project)}` : '') +
      `</p>` +
      (nota.comentarios.length > 0
        ? `<p>Comentarios:</p><ul>${nota.comentarios.map((c) => `<li>${escapar(c.text)}</li>`).join('')}</ul>`
        : '') +
      `<p><a href="${config.urlPublica.replace(/\/api\/portal$/, '')}/pendientes">Abrir en DS Monitor</a></p>`;
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
      asignarA?: string;
      tarea?: Partial<TaskItem>;
    };
    const id = (cuerpo.id ?? '').trim();
    if (!id) {
      throw new ErrorPuente('Falta el identificador del pendiente.', 400);
    }
    const sesion = acceso.sesionDe(tokenDe(contexto));
    const todas = datos.anotaciones.leer();
    const nota = todas[id] ?? { comentarios: [], actualizadoEn: '' };
    const ahora = new Date().toISOString();
    if (typeof cuerpo.comentario === 'string' && cuerpo.comentario.trim()) {
      nota.comentarios = [
        ...nota.comentarios,
        { text: cuerpo.comentario.trim(), at: ahora, by: sesion?.correo }
      ];
    }
    if (typeof cuerpo.hecho === 'boolean') {
      nota.hecho = cuerpo.hecho;
    }
    nota.actualizadoEn = ahora;
    await datos.anotaciones.escribir({ ...todas, [id]: nota });
    let aviso: string | undefined;
    if (cuerpo.asignarA !== undefined) {
      const quien = (cuerpo.asignarA ?? '').trim();
      if (!quien) {
        const actual = datos.anotaciones.leer();
        await datos.anotaciones.escribir({
          ...actual,
          [id]: { ...(actual[id] ?? nota), asignado: undefined, actualizadoEn: ahora }
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
          salida.push(...((await leido(cuenta))[parte] as T[]));
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

  const siHay = async <T>(
    hay: unknown,
    f: () => Promise<T[]>
  ): Promise<T[]> => (hay ? f() : []);

  const fuentes: Fuentes = {
    pendientes: async () => {
      const correo = await porBuzon<TaskItem>('pendientes', 'pendientes');
      const odooTareas = await siHay(cfg().odoo, async () =>
        actividadesComoPendientes(
          (await odoo()).actividades,
          (cfg().odoo as ConfiguracionOdoo).accountId
        )
      ).catch(() => [] as TaskItem[]);
      return conNotas([
        ...correo,
        ...datos.personales.leer(),
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
      ...(cfg().vercel ? licenciasVercel(cfg().vercel as ConfiguracionVercel) : [])
    ],
    dominios: () => datos.dominios.leer(),
    monitoreo: () =>
      siHay(cfg().monitoreo, () =>
        cache.obtener('monitoreo:destinos', ttl.monitoreo, () =>
          destinosMonitoreados(exigir(cfg().monitoreo, 'monitoreo'))
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
    dominios: () => datos.dominios.leer()
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

  // --- Lo que se recibe en lugar de ir a buscarlo ---

  registrarRutasIngesta(router, configInicial, almacen, () =>
    datos.emisores.leer()
  );

  return router;
}
