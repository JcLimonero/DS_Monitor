import type { Configuracion } from '../config/entorno.js';
import { Cache } from '../nucleo/cache.js';
import { ErrorConfiguracion, ErrorPuente } from '../nucleo/errores.js';
import { licenciasAnthropic } from '../proveedores/anthropic.js';
import { licenciasCursor } from '../proveedores/cursor.js';
import { licenciasFigma } from '../proveedores/figma.js';
import { actividadesComoPendientes, crmOdoo } from '../proveedores/odoo.js';
import { destinosMonitoreados } from '../proveedores/monitoreo.js';
import {
  desplieguesVercel,
  estadoPlataformaVercel,
  licenciasVercel
} from '../proveedores/vercel.js';
import { Router } from './router.js';

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
export function estadoDeConexiones(config: Configuracion): Estado[] {
  const filas: [string, boolean, string[]][] = [
    ['anthropic', config.anthropic !== undefined, ['licenses']],
    ['cursor', config.cursor !== undefined, ['licenses']],
    ['figma', config.figma !== undefined, ['licenses']],
    ['vercel', config.vercel !== undefined, ['deployments', 'licenses']],
    ['monitoreo', config.monitoreo !== undefined, ['monitors']],
    ['odoo', config.odoo !== undefined, ['crm']]
  ];

  return filas.map(([conexion, configurada, provee]) => ({
    conexion,
    configurada,
    provee,
    faltante: configurada ? undefined : CREDENCIAL_DE[conexion]
  }));
}

/** Rutas que el portal ya conoce pero que aun no tienen adaptador. */
const PENDIENTES_DE_CONSTRUIR: [string, string][] = [
  ['/calendar/google/trabajo/meetings', 'Google Calendar'],
  ['/calendar/microsoft/personal/meetings', 'Microsoft 365'],
  ['/ops/pendientes/tasks', 'Ops']
];

export function construirRutas(
  config: Configuracion,
  cache = new Cache()
): Router {
  const router = new Router();
  const ttl = config.cacheSegundos;

  router.get('/salud', async () => ({
    ok: true,
    version: '0.1.0',
    ahora: new Date().toISOString(),
    conexiones: estadoDeConexiones(config)
  }));

  // --- Licencias ---

  router.get('/licencias/anthropic/licenses', () =>
    cache.obtener('licencias:anthropic', ttl.licencias, () =>
      licenciasAnthropic(exigir(config.anthropic, 'anthropic'))
    )
  );

  router.get('/licencias/cursor/licenses', () =>
    cache.obtener('licencias:cursor', ttl.licencias, () =>
      licenciasCursor(exigir(config.cursor, 'cursor'))
    )
  );

  router.get('/licencias/figma/licenses', () =>
    cache.obtener('licencias:figma', ttl.licencias, () =>
      licenciasFigma(exigir(config.figma, 'figma'))
    )
  );

  // --- Vercel: despliegues, estado de la plataforma y su propia licencia ---

  router.get('/vercel/deployments', () =>
    cache.obtener('vercel:despliegues', ttl.despliegues, () =>
      desplieguesVercel(exigir(config.vercel, 'vercel'))
    )
  );

  router.get('/vercel/platform-status', () =>
    cache.obtener('vercel:estado', ttl.estadoPlataforma, () =>
      estadoPlataformaVercel(exigir(config.vercel, 'vercel'))
    )
  );

  router.get('/vercel/licenses', async () =>
    licenciasVercel(exigir(config.vercel, 'vercel'))
  );

  // --- Monitoreo ---

  router.get('/monitoreo/estado/targets', () =>
    cache.obtener('monitoreo:destinos', ttl.monitoreo, () =>
      destinosMonitoreados(exigir(config.monitoreo, 'monitoreo'))
    )
  );

  // --- CRM de Odoo ---

  const odoo = () =>
    cache.obtener('odoo:crm', ttl.crm, () =>
      crmOdoo(exigir(config.odoo, 'odoo'))
    );

  router.get(
    '/odoo/itech/opportunities',
    async () => (await odoo()).oportunidades
  );
  router.get('/odoo/itech/activities', async () => (await odoo()).actividades);
  router.get('/odoo/itech/tasks', async () => {
    const odooConfig = exigir(config.odoo, 'odoo');
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

  return router;
}
