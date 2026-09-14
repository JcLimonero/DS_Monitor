import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import { ErrorNoEncontrado } from '../nucleo/errores.js';
import { construirRutas } from './rutas.js';

/**
 * La costura entre el portal y el puente.
 *
 * El portal arma sus URLs juntando la `path` de cada conexion con el sufijo que
 * pide su adaptador. Si el puente no publica alguna de esas rutas, nadie se
 * entera hasta el dia en que se cambia esa conexion a modo gateway y devuelve
 * 404 en produccion.
 *
 * Esta prueba lee la configuracion real del portal y comprueba que cada ruta
 * que va a pedir exista aqui. Falla si alguien agrega una capacidad de un lado
 * y olvida el otro, que es exactamente como se habia colado el hueco de
 * /odoo/itech/tasks.
 */

/** Que sufijos pide el adaptador del portal por cada capacidad. */
const SUFIJOS: Record<string, string[]> = {
  tasks: ['/tasks'],
  meetings: ['/meetings'],
  monitors: ['/targets'],
  crm: ['/opportunities', '/activities'],
  licenses: ['/licenses'],
  deployments: ['/deployments', '/platform-status']
};

const CONFIG_DEL_PORTAL = fileURLToPath(
  new URL(
    '../../../portal/src/app/core/config/portal-defaults.ts',
    import.meta.url
  )
);

interface ConexionDelPortal {
  id: string;
  provee: string[];
  path: string;
}

/**
 * Saca las conexiones del archivo de configuracion del portal.
 *
 * Se lee como texto y no se importa: el puente no debe depender en tiempo de
 * ejecucion del codigo de una aplicacion Angular.
 */
export function leerConexionesDelPortal(fuente: string): ConexionDelPortal[] {
  const bloques =
    fuente.match(/\{[^{}]*?id:\s*'[^']+',[^{}]*?provides:[^}]*?\}/gs) ?? [];
  const conexiones: ConexionDelPortal[] = [];

  for (const bloque of bloques) {
    const id = /id:\s*'([^']+)'/.exec(bloque)?.[1];
    const path = /path:\s*'([^']+)'/.exec(bloque)?.[1];
    const provee = /provides:\s*\[([^\]]*)\]/.exec(bloque)?.[1];
    if (!id || !path || !provee) {
      continue;
    }
    conexiones.push({
      id,
      path,
      provee: [...provee.matchAll(/'([^']+)'/g)].map(
        (coincidencia) => coincidencia[1] as string
      )
    });
  }

  return conexiones;
}

describe('costura con el portal', () => {
  it('el puente publica todas las rutas que el portal va a pedir', async () => {
    let fuente: string;
    try {
      fuente = await readFile(CONFIG_DEL_PORTAL, 'utf8');
    } catch {
      // El puente se puede desplegar solo; si el portal no esta al lado, esta
      // comprobacion no aplica en lugar de fallar.
      return;
    }

    const conexiones = leerConexionesDelPortal(fuente);
    assert.ok(
      conexiones.length > 0,
      'no se pudo leer ninguna conexión del portal'
    );

    const router = construirRutas(leerConfiguracion());
    const faltantes: string[] = [];

    for (const conexion of conexiones) {
      for (const capacidad of conexion.provee) {
        for (const sufijo of SUFIJOS[capacidad] ?? []) {
          const ruta = `${conexion.path}${sufijo}`;
          try {
            await router.resolver(ruta, new URLSearchParams());
          } catch (error) {
            // Cualquier otro error significa que la ruta existe y fallo por
            // falta de credencial, que es lo normal sin configurar.
            if (error instanceof ErrorNoEncontrado) {
              faltantes.push(`${conexion.id} -> ${ruta}`);
            }
          }
        }
      }
    }

    assert.deepEqual(
      faltantes,
      [],
      `el portal pedirá rutas que el puente no publica:\n  ${faltantes.join('\n  ')}`
    );
  });

  it('sabe leer las conexiones aunque el archivo cambie de formato', () => {
    const conexiones = leerConexionesDelPortal(`
      export const PORTAL_DEFAULTS = {
        connections: [
          { id: 'uno', accountId: 'a', kind: 'vercel', mode: 'demo',
            provides: ['deployments', 'licenses'], path: '/vercel' },
          { id: 'sin-ruta', accountId: 'b', kind: 'local', mode: 'local',
            provides: ['tasks'] }
        ]
      };
    `);
    assert.equal(conexiones.length, 1);
    assert.equal(conexiones[0]?.path, '/vercel');
    assert.deepEqual(conexiones[0]?.provee, ['deployments', 'licenses']);
  });
});
