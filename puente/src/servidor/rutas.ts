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
import type { Person } from '../nucleo/contrato.js';
import {
  AlmacenIntegraciones,
  Configurador
} from '../integraciones/almacen-integraciones.js';
import { INTEGRACIONES, integracion } from '../integraciones/catalogo.js';
import { ClienteImap } from '../proveedores/imap.js';
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
import { leerCorreo } from '../proveedores/correo.js';
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
  odoo: 'ODOO_URL, ODOO_DB, ODOO_USUARIO y ODOO_API_KEY'
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
  almacenCorreo = new AlmacenCorreo(config.directorioCorreo)
): Estado[] {
  const filas: [string, boolean, string[]][] = [
    ['anthropic', config.anthropic !== undefined, ['licenses']],
    ['cursor', config.cursor !== undefined, ['licenses']],
    ['figma', config.figma !== undefined, ['licenses']],
    ['vercel', config.vercel !== undefined, ['deployments', 'licenses']],
    ['monitoreo', config.monitoreo !== undefined, ['monitors']],
    ['odoo', config.odoo !== undefined, ['crm']],
    ['github', config.github !== undefined, ['repos']]
  ];

  const fijas: Estado[] = filas.map(([conexion, configurada, provee]) => ({
    conexion,
    configurada,
    provee,
    faltante: configurada ? undefined : CREDENCIAL_DE[conexion]
  }));

  // Cada buzon es una conexion aparte, para que se enciendan de uno en uno.
  const correos: Estado[] = buzones(config, almacenCorreo).map((correo) => ({
    conexion: correo.id,
    configurada: correoListo(correo, config),
    provee: ['meetings', 'tasks', 'licenses'],
    faltante: correoListo(correo, config) ? undefined : faltanteDe(correo)
  }));

  return [...fijas, ...correos];
}

/** Los buzones del entorno con lo capturado desde Ajustes encima. */
function buzones(
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
        config.microsoftApp
      )
    )
    .filter((c): c is ConfiguracionCorreo => c !== undefined);
}

/** Los almacenes de datos propios: equipo, dominios y sesiones. */
export interface Datos {
  equipo: AlmacenJson<Person[]>;
  dominios: AlmacenJson<Dominio[]>;
  sesiones: AlmacenJson<Sesion[]>;
}

export function abrirDatos(directorio: string): Datos {
  return {
    equipo: new AlmacenJson<Person[]>(join(directorio, 'equipo.json'), []),
    dominios: new AlmacenJson<Dominio[]>(join(directorio, 'dominios.json'), []),
    sesiones: new AlmacenJson<Sesion[]>(join(directorio, 'sesiones.json'), [])
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
  if (correo.proveedor !== 'microsoft' && correo.contrasena !== '') {
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
    : `la contraseña del buzón (Ajustes → Correo o ${variableContrasena(correo.id)})`;
}

/** El token de administracion, para las rutas que editan buzones. */
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
const PENDIENTES_DE_CONSTRUIR: [string, string][] = [
  ['/ops/pendientes/tasks', 'Ops']
];

export function construirRutas(
  configInicial: Configuracion,
  cache = new Cache(),
  almacen = new AlmacenIngesta(configInicial.directorioIngesta),
  almacenCorreo = new AlmacenCorreo(configInicial.directorioCorreo),
  integraciones?: {
    almacen: AlmacenIntegraciones;
    configurador: Configurador;
  },
  datos = abrirDatos(configInicial.directorioDatos)
): Router {
  const router = new Router();
  const ttl = configInicial.cacheSegundos;
  const acceso = new Acceso(datos.sesiones);
  // Lo capturado desde Ajustes cambia la configuracion en caliente, asi que
  // las rutas la piden cada vez en lugar de quedarse con la del arranque.
  const cfg = (): Configuracion =>
    integraciones?.configurador.config() ?? configInicial;

  router.get('/salud', async () => ({
    ok: true,
    version: '0.1.0',
    ahora: new Date().toISOString(),
    conexiones: estadoDeConexiones(cfg(), almacenCorreo)
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

  router.get('/equipo', async () => datos.equipo.leer());

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
      cfg().microsoftApp
    );
    if (!cuenta) {
      throw new ErrorPuente(
        `No hay un buzón "${id}" en el puente: ni en CORREO_CUENTAS ni guardado desde Ajustes.`,
        404
      );
    }
    return cuenta;
  };

  const leido = (cuenta: ConfiguracionCorreo) =>
    cache.obtener(`correo:${cuenta.id}`, ttl.correo, () =>
      cuenta.proveedor === 'microsoft'
        ? leerCorreoMicrosoft(cuenta)
        : leerCorreo(cuenta)
    );

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
    return metodo === 'graph' || metodo === 'imap'
      ? (await leido(cuenta))[parte]
      : recibidoDe(cuenta, tipo);
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
    conAplicacion: cuenta.microsoft !== undefined,
    tenant: cuenta.microsoft?.tenant,
    clientId: cuenta.microsoft?.clientId,
    conectadaComo: cuenta.microsoft?.conectadaComo,
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
      if (!cuenta.contrasena) {
        return { ok: false, mensaje: 'Falta la contraseña del buzón.' };
      }
      const cliente = await ClienteImap.conectar({
        host: cuenta.host,
        puerto: cuenta.puerto,
        usuario: cuenta.usuario,
        contrasena: cuenta.contrasena,
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
    if (!cuenta.microsoft) {
      throw new ErrorConfiguracion(
        `El buzón "${cuenta.id}" no tiene client ID y client secret: guárdalos primero.`
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
    return {
      url: urlDeAutorizacion(
        cuenta.microsoft,
        `${cfg().urlPublica}/correo/oauth/callback`,
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
    if (!cuenta.microsoft) {
      return regresar('error', 'La cuenta ya no tiene aplicación registrada.');
    }
    try {
      const tokens = await canjearCodigo(
        cuenta.microsoft,
        parametros.get('code') ?? '',
        `${cfg().urlPublica}/correo/oauth/callback`
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
    const estado = estadoDeConexiones(cfg(), almacenCorreo).find(
      (e) => e.conexion === id
    );
    return {
      id,
      etiqueta: definicion.etiqueta,
      kind: definicion.kind,
      configurada: estado?.configurada ?? false,
      faltante: estado?.faltante,
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

  // --- Lo que se recibe en lugar de ir a buscarlo ---

  registrarRutasIngesta(router, configInicial, almacen);

  return router;
}
