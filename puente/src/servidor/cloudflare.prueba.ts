import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import {
  FECHA_PROVISIONAL,
  dominiosComoLicencias,
  validarDominio,
  type Dominio
} from '../datos/dominios.js';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import { ErrorPuente } from '../nucleo/errores.js';
import { abrirDatos, cargarDatos, construirRutas } from './rutas.js';

/** Las rutas de Cloudflare contra un puente aislado y una API simulada. */

const fetchOriginal = globalThis.fetch;
const dirs: string[] = [];
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});
after(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

const CUENTA = 'b'.repeat(32);
const idZona = (n: number) => n.toString(16).padStart(32, '0');

/** Tres zonas; solo `alfa.com` esta en Cloudflare Registrar. */
function apiSimulada(
  opciones: { registrar?: 'ok' | 'permiso' | 'transitorio' } = {}
) {
  const llamados: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url));
    llamados.push(u.pathname);
    const sobre = (result: unknown) =>
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result,
          result_info: { total_pages: 1, total_count: 1 }
        }),
        { status: 200 }
      );
    if (u.pathname.endsWith('/zones')) {
      return sobre(
        ['alfa.com', 'beta.com', 'gama.mx'].map((name, i) => ({
          id: idZona(i + 1),
          name,
          status: 'active',
          paused: false,
          plan: { name: 'Free Website' },
          name_servers: ['x.ns.cloudflare.com'],
          account: { id: CUENTA }
        }))
      );
    }
    if (u.pathname.endsWith('/registrar/registrations')) {
      if (opciones.registrar === 'transitorio') {
        return new Response('{}', { status: 503 });
      }
      return opciones.registrar === 'permiso'
        ? new Response('{}', { status: 403 })
        : sobre([
            {
              domain_name: 'alfa.com',
              expires_at: '2027-05-01T00:00:00Z',
              auto_renew: true
            }
          ]);
    }
    if (u.pathname.endsWith('/dns_records')) {
      return sobre([
        {
          id: idZona(100),
          name: 'api.alfa.com',
          type: 'A',
          content: '10.0.0.1',
          proxied: true,
          ttl: 1
        },
        {
          id: idZona(101),
          name: 'alfa.com',
          type: 'MX',
          content: 'mx.correo.com',
          proxied: false,
          ttl: 300,
          priority: 10
        }
      ]);
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return llamados;
}

async function montar(conToken = true) {
  const dir = await mkdtemp(join(tmpdir(), 'puente-cf-'));
  dirs.push(dir);
  const persistencia = new PersistenciaArchivos({
    datos: join(dir, 'datos'),
    ingesta: join(dir, 'ingesta'),
    correo: join(dir, 'correo'),
    integraciones: join(dir, 'integraciones')
  });
  const config = leerConfiguracion({
    PUENTE_ADMIN_TOKEN: 'prueba',
    ...(conToken
      ? {
          CLOUDFLARE_API_TOKEN: 'token-de-prueba',
          CLOUDFLARE_API_URL: 'https://cf.prueba/client/v4/'
        }
      : {})
  });
  const datos = abrirDatos(persistencia);
  await cargarDatos(datos, persistencia);
  const router = construirRutas(
    config,
    undefined,
    persistencia,
    undefined,
    undefined,
    undefined,
    datos
  );
  const admin = { authorization: 'Bearer prueba' };
  const post = (
    ruta: string,
    cuerpo: unknown,
    enc: Record<string, string> = admin
  ) => router.resolver(ruta, new URLSearchParams(), 'POST', cuerpo, enc);
  const get = (
    ruta: string,
    enc: Record<string, string> = admin,
    q = new URLSearchParams()
  ) => router.resolver(ruta, q, 'GET', undefined, enc);
  return { datos, post, get, config };
}

const estado = (e: unknown) => (e instanceof ErrorPuente ? e.estado : 0);

describe('configuracion de Cloudflare', () => {
  it('sin token no hay conexion y las rutas dicen que falta', async () => {
    const { get, config } = await montar(false);
    assert.equal(config.cloudflare, undefined);
    await assert.rejects(
      () => get('/cloudflare/zonas'),
      (e: unknown) =>
        estado(e) === 503 && /CLOUDFLARE_API_TOKEN/.test(String(e))
    );
  });

  it('la URL base sale de CLOUDFLARE_API_URL y por omision es la real', async () => {
    const { config } = await montar();
    assert.equal(config.cloudflare?.apiUrl, 'https://cf.prueba/client/v4');
    assert.equal(
      leerConfiguracion({ CLOUDFLARE_API_TOKEN: 'x' }).cloudflare?.apiUrl,
      'https://api.cloudflare.com/client/v4'
    );
  });
});

describe('rutas de Cloudflare', () => {
  it('son de administracion: sin token o con uno malo, 401', async () => {
    apiSimulada();
    const { get, post } = await montar();
    for (const enc of [
      {} as Record<string, string>,
      { authorization: 'Bearer malo' }
    ]) {
      await assert.rejects(
        () => get('/cloudflare/zonas', enc),
        (e: unknown) => estado(e) === 401
      );
      await assert.rejects(
        () => get(`/cloudflare/zonas/${idZona(1)}/subdominios`, enc),
        (e: unknown) => estado(e) === 401
      );
      await assert.rejects(
        () => post('/cloudflare/importar', { nombres: ['alfa.com'] }, enc),
        (e: unknown) => estado(e) === 401
      );
    }
  });

  it('zonas: combina las registradas en Cloudflare y usa cache', async () => {
    const llamados = apiSimulada();
    const { get } = await montar();
    const r = (await get('/cloudflare/zonas')) as {
      zonas: { nombre: string; registro?: { venceEn: string } }[];
      conFechas: boolean;
    };
    assert.deepEqual(
      r.zonas.map((z) => z.nombre),
      ['alfa.com', 'beta.com', 'gama.mx']
    );
    assert.equal(r.zonas[0]!.registro?.venceEn, '2027-05-01T12:00:00.000Z');
    assert.equal(r.zonas[1]!.registro, undefined);
    assert.equal(r.conFechas, true);
    const antes = llamados.length;
    await get('/cloudflare/zonas');
    assert.equal(llamados.length, antes, 'la segunda lectura sale de cache');
    await get(
      '/cloudflare/zonas',
      undefined,
      new URLSearchParams('refrescar=1')
    );
    assert.ok(llamados.length > antes, 'refrescar=1 vuelve a pedir');
  });

  it('un token sin permiso se explica sin tumbar la pantalla', async () => {
    globalThis.fetch = (async () =>
      new Response('{}', { status: 403 })) as typeof fetch;
    const { get } = await montar();
    const r = (await get('/cloudflare/zonas')) as {
      zonas: unknown[];
      problema?: { tipo: string; mensaje: string };
    };
    assert.deepEqual(r.zonas, []);
    assert.equal(r.problema?.tipo, 'sin-permiso');
    assert.match(r.problema!.mensaje, /Zone:Read y DNS:Read/);
  });

  it('zonas sigue sin fechas si el token no llega al Registrar', async () => {
    apiSimulada({ registrar: 'permiso' });
    const { get } = await montar();
    const r = (await get('/cloudflare/zonas')) as {
      zonas: { registro?: unknown }[];
      conFechas: boolean;
    };
    assert.equal(r.zonas.length, 3);
    assert.ok(r.zonas.every((z) => z.registro === undefined));
    assert.equal(r.conFechas, false);
  });

  it('subdominios: agrupa por host y rechaza una zona que no es suya', async () => {
    apiSimulada();
    const { get } = await montar();
    const r = (await get(`/cloudflare/zonas/${idZona(1)}/subdominios`)) as {
      zona: string;
      subdominios: { host: string; proxied: boolean; total: number }[];
      registros: number;
      truncado: boolean;
    };
    assert.equal(r.zona, 'alfa.com');
    assert.deepEqual(
      r.subdominios.map((s) => s.host),
      ['@', 'api']
    );
    assert.equal(r.subdominios[1]!.proxied, true);
    assert.equal(r.registros, 2);
    assert.equal(r.truncado, false);
    await assert.rejects(
      () => get(`/cloudflare/zonas/${idZona(77)}/subdominios`),
      (e: unknown) => estado(e) === 404
    );
  });

  it('importar: usa la fecha del Registrar y deja sin fecha lo demas', async () => {
    apiSimulada();
    const { post, datos } = await montar();
    const r = (await post('/cloudflare/importar', {
      nombres: ['alfa.com', 'BETA.com', 'beta.com']
    })) as {
      importados: string[];
      existentes: string[];
      sinFecha: string[];
    };
    assert.deepEqual(r.importados, ['alfa.com', 'beta.com']);
    assert.deepEqual(r.existentes, []);
    assert.deepEqual(r.sinFecha, ['beta.com']);
    const lista = datos.dominios.leer();
    const alfa = lista.find((d) => d.nombre === 'alfa.com')!;
    assert.equal(alfa.registrador, 'Cloudflare');
    assert.equal(alfa.venceEn, '2027-05-01T12:00:00.000Z');
    assert.equal(alfa.automatico, true);
    assert.equal(alfa.sinFecha, undefined);
    const beta = lista.find((d) => d.nombre === 'beta.com')!;
    assert.equal(beta.sinFecha, true);
    assert.equal(beta.venceEn, FECHA_PROVISIONAL);
    assert.equal(beta.registrador, undefined);
    assert.equal(beta.costo, undefined);
  });

  it('importar no pisa lo que ya existe, ni lo capturado a mano', async () => {
    apiSimulada();
    const { post, datos } = await montar();
    const mio: Dominio = {
      nombre: 'alfa.com',
      registrador: 'Neubox',
      venceEn: '2026-12-01T00:00:00.000Z',
      costo: 250,
      moneda: 'MXN',
      automatico: false,
      notas: 'mio'
    };
    await datos.dominios.escribir([mio]);
    const r = (await post('/cloudflare/importar', {
      nombres: ['alfa.com', 'gama.mx']
    })) as { importados: string[]; existentes: string[]; sinFecha: string[] };
    assert.deepEqual(r.existentes, ['alfa.com']);
    assert.deepEqual(r.importados, ['gama.mx']);
    assert.deepEqual(
      datos.dominios.leer().find((d) => d.nombre === 'alfa.com'),
      mio
    );
    // Repetir no duplica.
    const otra = (await post('/cloudflare/importar', {
      nombres: ['alfa.com', 'gama.mx']
    })) as { importados: string[]; existentes: string[] };
    assert.deepEqual(otra.importados, []);
    assert.deepEqual(otra.existentes, ['alfa.com', 'gama.mx']);
    assert.equal(datos.dominios.leer().length, 2);
  });

  it('importar valida: lista, tope y solo dominios de Cloudflare', async () => {
    apiSimulada();
    const { post, datos } = await montar();
    for (const cuerpo of [
      {},
      { nombres: [] },
      { nombres: 'alfa.com' },
      { nombres: [1] },
      { nombres: Array.from({ length: 501 }, (_, i) => `d${i}.com`) }
    ]) {
      await assert.rejects(
        () => post('/cloudflare/importar', cuerpo),
        (e: unknown) => estado(e) === 400
      );
    }
    await assert.rejects(
      () => post('/cloudflare/importar', { nombres: ['otro.com'] }),
      (e: unknown) => estado(e) === 400 && /otro\.com/.test(String(e))
    );
    assert.equal(datos.dominios.leer().length, 0);
  });

  it('un dominio sin fecha no cuenta como licencia ni como vencido', async () => {
    apiSimulada();
    const { post, datos } = await montar();
    await post('/cloudflare/importar', { nombres: ['beta.com', 'alfa.com'] });
    const licencias = dominiosComoLicencias(datos.dominios.leer(), 'dominios');
    assert.deepEqual(
      licencias.map((l) => l.product),
      ['Dominio alfa.com']
    );
    assert.ok(!licencias.some((l) => /VENCIDO/.test(l.plan ?? '')));
  });
});

describe('Registrar: fallos pasajeros y estables', () => {
  const registrarLlamados = (l: string[]) =>
    l.filter((p) => p.endsWith('/registrar/registrations')).length;

  it('un fallo pasajero no se guarda en cache: el siguiente intento recupera las fechas', async () => {
    const opciones: { registrar: 'ok' | 'permiso' | 'transitorio' } = {
      registrar: 'transitorio'
    };
    const llamados = apiSimulada(opciones);
    const { get } = await montar();
    const primero = (await get('/cloudflare/zonas')) as {
      zonas: { registro?: unknown }[];
      registrarFallo: boolean;
    };
    assert.equal(primero.registrarFallo, true);
    assert.ok(primero.zonas.every((z) => z.registro === undefined));
    opciones.registrar = 'ok';
    const segundo = (await get('/cloudflare/zonas')) as {
      zonas: { nombre: string; registro?: { venceEn: string } }[];
      registrarFallo: boolean;
    };
    assert.equal(segundo.registrarFallo, false);
    assert.equal(
      segundo.zonas[0]!.registro?.venceEn,
      '2027-05-01T12:00:00.000Z'
    );
    assert.equal(registrarLlamados(llamados), 2);
    // Ya con resultado bueno, ahora si queda en cache.
    await get('/cloudflare/zonas');
    assert.equal(registrarLlamados(llamados), 2);
  });

  it('sin permiso en el Registrar es estable y si se guarda en cache', async () => {
    const llamados = apiSimulada({ registrar: 'permiso' });
    const { get } = await montar();
    const a = (await get('/cloudflare/zonas')) as { registrarFallo: boolean };
    await get('/cloudflare/zonas');
    assert.equal(a.registrarFallo, false);
    assert.equal(registrarLlamados(llamados), 1);
  });

  it('importar con el Registrar caido avisa que quedaron sin fecha por eso', async () => {
    apiSimulada({ registrar: 'transitorio' });
    const { post, datos } = await montar();
    const r = (await post('/cloudflare/importar', {
      nombres: ['alfa.com']
    })) as { sinFecha: string[]; registrarFallo: boolean };
    assert.deepEqual(r.sinFecha, ['alfa.com']);
    assert.equal(r.registrarFallo, true);
    assert.equal(datos.dominios.leer()[0]!.sinFecha, true);
  });

  it('si todos traen fecha, importar no marca fallo aunque el Registrar este caido', async () => {
    apiSimulada({ registrar: 'ok' });
    const { post } = await montar();
    const r = (await post('/cloudflare/importar', {
      nombres: ['alfa.com']
    })) as { registrarFallo: boolean };
    assert.equal(r.registrarFallo, false);
  });

  it('la respuesta de zonas no trae la cuenta de Cloudflare', async () => {
    apiSimulada();
    const { get } = await montar();
    const r = (await get('/cloudflare/zonas')) as { zonas: object[] };
    assert.ok(r.zonas.every((z) => !('cuentaId' in z)));
  });

  it('renovar un dominio sin fecha pide capturarla primero (400)', async () => {
    apiSimulada();
    const { post } = await montar();
    await post('/cloudflare/importar', { nombres: ['beta.com'] });
    await assert.rejects(
      () =>
        post('/licencias/renovar', {
          id: 'dominios-beta-com',
          renuevaEn: '2027-01-01'
        }),
      (e: unknown) =>
        estado(e) === 400 &&
        /todavía no tiene fecha de vencimiento/.test(String(e))
    );
  });
});

describe('dominio sin fecha de vencimiento', () => {
  it('se valida sin fecha y sin costo, y al capturarla se quita la marca', () => {
    const sin = validarDominio(
      { nombre: 'X.com', sinFecha: true, costo: 99 },
      'd'
    );
    assert.equal(sin.sinFecha, true);
    assert.equal(sin.venceEn, FECHA_PROVISIONAL);
    // El costo se conserva (no cuenta mientras no haya fecha).
    assert.equal(sin.costo, 99);
    const con = validarDominio(
      { ...sin, venceEn: '2027-01-15', sinFecha: true, costo: 99 },
      'd'
    );
    assert.equal(con.sinFecha, undefined);
    assert.equal(con.venceEn, '2027-01-15T00:00:00.000Z');
    assert.equal(con.costo, 99);
    assert.throws(() => validarDominio({ nombre: 'x.com' }, 'd'), /venceEn/);
    assert.throws(
      () => validarDominio({ nombre: 'x.com', venceEn: 'no' }, 'd'),
      /venceEn/
    );
  });

  it('guardar desde Dominios conserva la marca de los que no se tocaron', async () => {
    apiSimulada();
    const { post, datos } = await montar();
    await post('/cloudflare/importar', { nombres: ['beta.com'] });
    const lista = datos.dominios.leer();
    const guardados = (await post('/dominios/guardar', {
      dominios: lista
    })) as Dominio[];
    assert.equal(guardados[0]!.sinFecha, true);
    const capturado = (await post('/dominios/guardar', {
      dominios: [{ ...lista[0], venceEn: '2027-02-02' }]
    })) as Dominio[];
    assert.equal(capturado[0]!.sinFecha, undefined);
  });
});
