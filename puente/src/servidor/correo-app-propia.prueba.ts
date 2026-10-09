import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import { ErrorPuente } from '../nucleo/errores.js';
import { canjearCodigo } from '../proveedores/microsoft.js';
import { Redireccion } from './router.js';
import { abrirDatos, cargarDatos, construirRutas } from './rutas.js';

/**
 * Aplicacion de Entra ID propia por buzon, de punta a punta por las rutas.
 * Todo con valores falsos y con `fetch` simulado: nunca se contacta a
 * Microsoft.
 */

const ID_GENERAL = '11111111-1111-4111-8111-111111111111';
const ID_PROPIO = '22222222-2222-4222-8222-222222222222';
const ID_OTRO = '33333333-3333-4333-8333-333333333333';
const TENANT = '44444444-4444-4444-8444-444444444444';
const SECRETO_GENERAL = 'secreto-general-falso~123';
const SECRETO_PROPIO = 'secreto-propio-falso~456';
const SECRETO_NUEVO = 'secreto-nuevo-falso~789';
const SECRETOS = [SECRETO_GENERAL, SECRETO_PROPIO, SECRETO_NUEVO];
const URL_PUBLICA = 'http://puente.falso.test';

const dirs: string[] = [];
const fetchOriginal = globalThis.fetch;
after(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

interface PeticionToken {
  url: string;
  cuerpo: URLSearchParams;
}
let tokens: PeticionToken[] = [];
let respuestaToken: () => { estado: number; json: unknown };
/** Si existe, el endpoint de token no contesta hasta que se resuelva. */
let compuertaToken: Promise<void> | undefined;

beforeEach(() => {
  tokens = [];
  compuertaToken = undefined;
  respuestaToken = () => ({
    estado: 200,
    json: {
      access_token: 'at-falso',
      refresh_token: 'rt-falso',
      expires_in: 3600
    }
  });
  globalThis.fetch = (async (entrada: unknown, opciones?: RequestInit) => {
    const url = String(entrada);
    if (url.includes('login.microsoftonline.com')) {
      tokens.push({
        url,
        cuerpo: new URLSearchParams(String(opciones?.body ?? ''))
      });
      await compuertaToken;
      const r = respuestaToken();
      return new Response(JSON.stringify(r.json), { status: r.estado });
    }
    if (url.includes('graph.microsoft.com/v1.0/me')) {
      return new Response(JSON.stringify({ mail: 'quien@falso.test' }), {
        status: 200
      });
    }
    throw new Error(`fetch inesperado en la prueba: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

async function montar(tenantGeneral = 'common') {
  const dir = await mkdtemp(join(tmpdir(), 'puente-appprop-rutas-'));
  dirs.push(dir);
  const persistencia = new PersistenciaArchivos({
    datos: join(dir, 'datos'),
    ingesta: join(dir, 'ingesta'),
    correo: join(dir, 'correo'),
    integraciones: join(dir, 'integraciones')
  });
  const config = leerConfiguracion({
    PUENTE_ADMIN_TOKEN: 'prueba',
    PUENTE_URL_PUBLICA: URL_PUBLICA,
    MICROSOFT_CLIENT_ID: ID_GENERAL,
    MICROSOFT_CLIENT_SECRET: SECRETO_GENERAL,
    MICROSOFT_TENANT: tenantGeneral
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
  const post = (ruta: string, cuerpo: unknown) =>
    router.resolver(ruta, new URLSearchParams(), 'POST', cuerpo, admin);
  const get = (ruta: string, params = new URLSearchParams()) =>
    router.resolver(ruta, params);
  const guardar = (id: string, cuerpo: Record<string, unknown>) =>
    post(`/correo/${id}/guardar`, cuerpo);
  const estado = (id: string) => get(`/correo/${id}/estado`) as Promise<any>;
  const inicio = async (id: string) => {
    const { url } = (await post(`/correo/${id}/oauth/inicio`, {
      volver: 'http://portal.falso.test/correo'
    })) as { url: string };
    const u = new URL(url);
    return { url: u, state: u.searchParams.get('state') as string };
  };
  const regreso = (state: string) =>
    get(
      '/correo/oauth/callback',
      new URLSearchParams({ state, code: 'codigo-falso-1' })
    ) as Promise<Redireccion>;
  return { router, guardar, estado, inicio, regreso, post, get };
}

type Banco = Awaited<ReturnType<typeof montar>>;

/** Dos buzones de Microsoft: uno con aplicacion propia y otro con la general. */
async function conDosBuzones(b: Banco) {
  await b.guardar('correo-a', {
    proveedor: 'microsoft',
    usuario: 'a@falso.test'
  });
  await b.guardar('correo-itech', {
    proveedor: 'microsoft',
    usuario: 'i@falso.test',
    tenant: TENANT,
    clientId: ID_PROPIO,
    clientSecret: SECRETO_PROPIO
  });
}

function sinSecretos(valor: unknown, donde: string): void {
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  for (const secreto of SECRETOS) {
    assert.ok(!texto.includes(secreto), `${donde} trae un secreto: ${texto}`);
    assert.ok(
      !texto.includes(encodeURIComponent(secreto)),
      `${donde} trae un secreto codificado`
    );
  }
}

describe('aplicacion propia por buzon', () => {
  it('sin aplicacion propia todo usa la general', async () => {
    const b = await montar();
    await b.guardar('correo-a', {
      proveedor: 'microsoft',
      usuario: 'a@falso.test'
    });
    const e = await b.estado('correo-a');
    assert.equal(e.appPropiaDefinida, false);
    assert.equal(e.appPropiaClientId, undefined);
    assert.equal(e.conAplicacion, true);
    const { url } = await b.inicio('correo-a');
    assert.equal(url.searchParams.get('client_id'), ID_GENERAL);
    assert.ok(url.pathname.startsWith('/common/'));
  });

  it('el buzon con app propia no usa la general y los demas no cambian', async () => {
    const b = await montar();
    await conDosBuzones(b);
    const itech = await b.inicio('correo-itech');
    assert.equal(itech.url.searchParams.get('client_id'), ID_PROPIO);
    assert.ok(itech.url.pathname.startsWith(`/${TENANT}/`));
    const a = await b.inicio('correo-a');
    assert.equal(a.url.searchParams.get('client_id'), ID_GENERAL);
    assert.ok(a.url.pathname.startsWith('/common/'));
    assert.equal(
      a.url.searchParams.get('redirect_uri'),
      `${URL_PUBLICA}/correo/oauth/callback`
    );
    assert.equal(
      itech.url.searchParams.get('redirect_uri'),
      `${URL_PUBLICA}/correo/oauth/callback`
    );
    const e = await b.estado('correo-itech');
    assert.equal(e.appPropiaDefinida, true);
    assert.equal(e.appPropiaClientId, ID_PROPIO);
    assert.equal(e.tenant, TENANT);
  });

  it('el canje del codigo y el refresco usan la app del buzon', async () => {
    const b = await montar();
    await conDosBuzones(b);

    const itech = await b.inicio('correo-itech');
    const ok = await b.regreso(itech.state);
    assert.equal(new URL(ok.url).searchParams.get('oauth'), 'ok');
    assert.equal(tokens.length, 1);
    assert.ok(tokens[0]?.url.includes(`/${TENANT}/oauth2/v2.0/token`));
    assert.equal(tokens[0]?.cuerpo.get('client_id'), ID_PROPIO);
    assert.equal(tokens[0]?.cuerpo.get('client_secret'), SECRETO_PROPIO);
    assert.equal(tokens[0]?.cuerpo.get('grant_type'), 'authorization_code');

    const a = await b.inicio('correo-a');
    await b.regreso(a.state);
    assert.equal(tokens[1]?.cuerpo.get('client_id'), ID_GENERAL);
    assert.equal(tokens[1]?.cuerpo.get('client_secret'), SECRETO_GENERAL);

    // La prueba (refresco de token + Graph) tambien sale con la app de cada uno.
    tokens = [];
    const pi = (await b.post('/correo/correo-itech/probar', {})) as any;
    assert.equal(pi.ok, true);
    assert.equal(tokens[0]?.cuerpo.get('grant_type'), 'refresh_token');
    assert.equal(tokens[0]?.cuerpo.get('client_id'), ID_PROPIO);
    assert.equal(tokens[0]?.cuerpo.get('client_secret'), SECRETO_PROPIO);
    const pa = (await b.post('/correo/correo-a/probar', {})) as any;
    assert.equal(pa.ok, true);
    assert.equal(tokens[1]?.cuerpo.get('client_id'), ID_GENERAL);
  });

  it('el estado del OAuth sigue ligado al buzon y es de un solo uso', async () => {
    const b = await montar();
    await conDosBuzones(b);
    const itech = await b.inicio('correo-itech');
    const ok = await b.regreso(itech.state);
    // Regresa al buzon que lo pidio, y solo a ese.
    assert.equal(new URL(ok.url).searchParams.get('correo'), 'correo-itech');
    // Y el token se guardo en ese buzon, no en el otro.
    assert.equal((await b.estado('correo-itech')).metodo, 'graph');
    assert.notEqual((await b.estado('correo-a')).metodo, 'graph');
    // No se puede reusar.
    await assert.rejects(
      () => b.regreso(itech.state),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
    // Uno inventado tampoco.
    await assert.rejects(
      () => b.regreso('inventado'),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
    assert.equal(tokens.length, 1);
  });

  it('si la app del buzon cambia a mitad del consentimiento, el codigo no se canjea', async () => {
    const b = await montar();
    await conDosBuzones(b);
    const itech = await b.inicio('correo-itech');
    await b.guardar('correo-itech', {
      clientId: ID_OTRO,
      clientSecret: SECRETO_NUEVO
    });
    const r = await b.regreso(itech.state);
    assert.equal(new URL(r.url).searchParams.get('oauth'), 'error');
    assert.equal(tokens.length, 0, 'no debio salir ningun canje');
    // Quitar la propia durante el consentimiento tambien lo invalida.
    const otra = await b.inicio('correo-itech');
    await b.guardar('correo-itech', { clientSecret: ' ' });
    const r2 = await b.regreso(otra.state);
    assert.equal(new URL(r2.url).searchParams.get('oauth'), 'error');
    assert.equal(tokens.length, 0);
  });

  it('cambiar o quitar la propia no afecta a otros buzones', async () => {
    const b = await montar();
    await conDosBuzones(b);
    await b.regreso((await b.inicio('correo-itech')).state);
    await b.regreso((await b.inicio('correo-a')).state);
    // Cambiar el secreto de itech (mismo ID) conserva su conexion.
    await b.guardar('correo-itech', { clientSecret: SECRETO_NUEVO });
    assert.equal((await b.estado('correo-itech')).metodo, 'graph');
    // Quitarla: itech vuelve a la general y pide reconectar; el otro sigue igual.
    const quitado = await b.guardar('correo-itech', { clientSecret: ' ' });
    assert.equal((quitado as any).appPropiaDefinida, false);
    assert.notEqual((await b.estado('correo-itech')).metodo, 'graph');
    assert.equal(
      (await b.inicio('correo-itech')).url.searchParams.get('client_id'),
      ID_GENERAL
    );
    assert.equal((await b.estado('correo-a')).metodo, 'graph');
    assert.equal((await b.estado('correo-a')).appPropiaDefinida, false);
    // Y la general nunca se toco: el otro buzon la sigue usando.
    tokens = [];
    await b.post('/correo/correo-a/probar', {});
    assert.equal(tokens[0]?.cuerpo.get('client_secret'), SECRETO_GENERAL);
  });

  it('el secreto no sale en ninguna respuesta, error ni redireccion', async () => {
    const b = await montar();
    const respuestas: [string, unknown][] = [];
    respuestas.push([
      'guardar',
      await b.guardar('correo-itech', {
        proveedor: 'microsoft',
        usuario: 'i@falso.test',
        tenant: TENANT,
        clientId: ID_PROPIO,
        clientSecret: SECRETO_PROPIO
      })
    ]);
    await b.guardar('correo-a', {
      proveedor: 'microsoft',
      usuario: 'a@falso.test'
    });
    respuestas.push(['estado', await b.estado('correo-itech')]);
    const inicio = await b.inicio('correo-itech');
    respuestas.push(['inicio', inicio.url.toString()]);
    respuestas.push(['regreso ok', (await b.regreso(inicio.state)).url]);
    respuestas.push([
      'probar ok',
      await b.post('/correo/correo-itech/probar', {})
    ]);

    // Entra contesta con un error que REPITE el secreto y el codigo: no debe salir.
    respuestaToken = () => ({
      estado: 400,
      json: {
        error: 'invalid_client',
        error_description: `AADSTS7000215: Invalid client secret provided: ${SECRETO_PROPIO}. codigo-falso-1 rt-falso`
      }
    });
    const i2 = await b.inicio('correo-itech');
    const conError = (await b.regreso(i2.state)).url;
    assert.equal(new URL(conError).searchParams.get('oauth'), 'error');
    assert.ok(conError.includes('invalid_client'), 'debe llevar el motivo');
    respuestas.push(['regreso error', conError]);
    // El refresco tambien falla con el secreto en el mensaje.
    tokens = [];
    await b.guardar('correo-itech', { clientSecret: SECRETO_PROPIO }); // rota (mismo ID)
    const probarError = (await b.post('/correo/correo-itech/probar', {})) as {
      ok: boolean;
      mensaje: string;
    };
    assert.equal(probarError.ok, false);
    assert.ok(probarError.mensaje.includes('[oculto]'));
    respuestas.push(['probar error', probarError]);
    // Errores de validacion al guardar.
    for (const cuerpo of [
      { clientId: 'no-guid', clientSecret: SECRETO_NUEVO },
      { clientId: ID_OTRO },
      { clientSecret: 'corto' },
      { tenant: '../malo' }
    ]) {
      try {
        await b.guardar('correo-itech', cuerpo);
        assert.fail('debio rechazar');
      } catch (e) {
        assert.ok(e instanceof ErrorPuente && e.estado === 400);
        respuestas.push(['validacion', e.message]);
      }
    }
    // Lo que se puede consultar sin token.
    const salud = (await b.get('/salud')) as unknown;
    respuestas.push(['salud', salud]);
    respuestas.push(['integraciones', await b.get('/integraciones')]);
    for (const id of ['microsoft']) {
      respuestas.push([
        `integracion ${id}`,
        await b.get(`/integraciones/${id}`).catch((e) => String(e))
      ]);
    }

    for (const [donde, valor] of respuestas) {
      sinSecretos(valor, donde);
    }
    // Y las llaves del estado son exactamente las esperadas: nada de clientSecret.
    const e = await b.estado('correo-itech');
    assert.ok(!('clientSecret' in e));
    assert.ok(!('refreshToken' in e));
  });

  it('valida entradas y no escribe nada cuando rechaza', async () => {
    const b = await montar();
    await conDosBuzones(b);
    const antes = await b.estado('correo-itech');
    const malos: Record<string, unknown>[] = [
      { clientId: 'x', clientSecret: SECRETO_NUEVO },
      { clientId: ID_OTRO },
      { clientSecret: 'sin id' },
      { tenant: 'a/b' },
      { tenant: 7 },
      { clientId: ID_OTRO, clientSecret: 'con espacios dentro 123' },
      { clientId: ID_OTRO, clientSecret: 'x'.repeat(400) }
    ];
    for (const cuerpo of malos) {
      await assert.rejects(
        () => b.guardar('correo-itech', cuerpo),
        (e: unknown) => e instanceof ErrorPuente && e.estado === 400,
        JSON.stringify(cuerpo)
      );
    }
    assert.deepEqual(await b.estado('correo-itech'), antes);
  });

  it('la aplicacion propia solo se acepta en buzones de Microsoft', async () => {
    const b = await montar();
    await assert.rejects(
      () =>
        b.guardar('correo-g', {
          proveedor: 'google',
          usuario: 'g@falso.test',
          clientId: ID_PROPIO,
          clientSecret: SECRETO_PROPIO
        }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
  });

  it('las rutas de edicion siguen pidiendo el token de administracion', async () => {
    const b = await montar();
    await assert.rejects(
      () =>
        b.router.resolver(
          '/correo/correo-a/guardar',
          new URLSearchParams(),
          'POST',
          { clientId: ID_PROPIO, clientSecret: SECRETO_PROPIO },
          {}
        ),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 401
    );
  });

  it('un buzon guardado antes de esta funcion (sin app propia) sigue conectado', async () => {
    const b = await montar();
    await b.guardar('correo-a', {
      proveedor: 'microsoft',
      usuario: 'a@falso.test',
      tenant: 'common'
    });
    await b.regreso((await b.inicio('correo-a')).state);
    // Guardar otra vez solo el correo (como hace el portal) no rompe la conexion.
    await b.guardar('correo-a', { usuario: 'a@falso.test', tenant: 'common' });
    const e = await b.estado('correo-a');
    assert.equal(e.metodo, 'graph');
    assert.equal(e.appPropiaDefinida, false);
  });

  it('carrera: si /guardar cambia la app durante el canje, el token de A no queda bajo B', async () => {
    for (const cambio of [
      { clientId: ID_OTRO, clientSecret: SECRETO_NUEVO },
      { clientSecret: ' ' }
    ]) {
      const b = await montar();
      await conDosBuzones(b);
      const itech = await b.inicio('correo-itech');
      let soltar!: () => void;
      compuertaToken = new Promise<void>((r) => (soltar = r));
      const pendiente = b.regreso(itech.state);
      while (tokens.length < 1) {
        await new Promise((r) => setImmediate(r));
      }
      // El canje con la app A esta en vuelo; el administrador cambia la app.
      await b.guardar('correo-itech', cambio);
      soltar();
      const r = await pendiente;
      assert.equal(new URL(r.url).searchParams.get('oauth'), 'error');
      const e = await b.estado('correo-itech');
      assert.notEqual(e.metodo, 'graph', 'quedo un token de la app anterior');
      assert.equal(e.conectadaComo, undefined);
      // Y reconectar con la app vigente si funciona.
      compuertaToken = undefined;
      const nuevo = await b.inicio('correo-itech');
      const ok = await b.regreso(nuevo.state);
      assert.equal(new URL(ok.url).searchParams.get('oauth'), 'ok');
      assert.equal((await b.estado('correo-itech')).metodo, 'graph');
    }
  });

  it('un documento viejo con el ID y secreto de la general sigue siendo la general', async () => {
    const b = await montar(TENANT);
    await b.guardar('correo-a', {
      proveedor: 'microsoft',
      usuario: 'a@falso.test',
      clientId: ID_GENERAL.toUpperCase(),
      clientSecret: SECRETO_GENERAL
    });
    const e = await b.estado('correo-a');
    assert.equal(e.appPropiaDefinida, false);
    assert.equal(e.appPropiaClientId, undefined);
    assert.equal(e.tenant, TENANT);
    const { url } = await b.inicio('correo-a');
    assert.equal(url.searchParams.get('client_id'), ID_GENERAL);
    assert.ok(url.pathname.startsWith(`/${TENANT}/`));
  });

  it('los errores de Entra no dejan secretos partidos por el corte ni codificados', async () => {
    const secreto = 'sec/ret+o=falso~Z9y8x7';
    const codificados = [
      secreto,
      encodeURIComponent(secreto),
      new URLSearchParams({ x: secreto }).toString().slice(2)
    ];
    const descripcion = `${'a'.repeat(175)}${secreto} ${codificados[1]} ${codificados[2]} ${'b'.repeat(50)}`;
    respuestaToken = () => ({
      estado: 400,
      json: { error: 'invalid_client', error_description: descripcion }
    });
    await assert.rejects(
      () =>
        canjearCodigo(
          { tenant: 'common', clientId: ID_PROPIO, clientSecret: secreto },
          'codigo-falso-1',
          `${URL_PUBLICA}/correo/oauth/callback`
        ),
      (e: unknown) => {
        const m = (e as Error).message;
        for (const c of codificados) {
          assert.ok(!m.includes(c), 'trae el secreto');
          // Ni un trozo largo: el corte no debe dejar la mitad del secreto.
          assert.ok(!m.includes(c.slice(0, 8)), 'trae un trozo del secreto');
        }
        assert.ok(m.includes('[oculto]'));
        return true;
      }
    );
  });
});
