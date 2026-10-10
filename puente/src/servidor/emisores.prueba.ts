import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { leerConfiguracion, type ClienteIngesta } from '../config/entorno.js';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import { ErrorPuente } from '../nucleo/errores.js';
import { abrirDatos, cargarDatos, construirRutas } from './rutas.js';
import type { Programable } from './rutas-ia.js';

/**
 * Pruebas de las rutas de emisores: crear, listar, actualizar tipos y borrar.
 */

const dirs: string[] = [];
after(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

async function montar() {
  const dir = await mkdtemp(join(tmpdir(), 'puente-emisores-'));
  dirs.push(dir);
  const persistencia = new PersistenciaArchivos({
    datos: join(dir, 'datos'),
    ingesta: join(dir, 'ingesta'),
    correo: join(dir, 'correo'),
    integraciones: join(dir, 'integraciones')
  });
  const config = leerConfiguracion({
    PUENTE_ADMIN_TOKEN: 'prueba'
  });
  const datos = abrirDatos(persistencia);
  await cargarDatos(datos, persistencia);
  await datos.emisores.escribir([]);
  const programables: Programable[] = [];
  const router = construirRutas(
    config,
    undefined,
    persistencia,
    undefined,
    undefined,
    undefined,
    datos,
    programables
  );
  const admin = { authorization: 'Bearer prueba' };
  const post = (ruta: string, cuerpo: unknown) =>
    router.resolver(ruta, new URLSearchParams(), 'POST', cuerpo, admin);
  const get = (ruta: string) =>
    router.resolver(ruta, new URLSearchParams(), 'GET', undefined, admin);

  return { datos, post, get };
}

describe('emisores', async () => {
  it('crear emisor devuelve token y lo guarda', async () => {
    const { datos, post } = await montar();

    const res = (await post('/emisores/guardar', {
      nombre: 'bot-prueba',
      tipos: ['pendientes']
    })) as ClienteIngesta & { token: string; aviso: string };

    assert.ok(res.token, 'debe devolver un token');
    assert.equal(res.nombre, 'bot-prueba');
    assert.deepEqual(res.tipos, ['pendientes']);

    const lista = datos.emisores.leer();
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.nombre, 'bot-prueba');
    assert.ok(lista[0]!.token, 'el emisor guardado tiene token');
  });

  it('actualizar tipos de emisor existente conserva el token', async () => {
    const { datos, post } = await montar();
    await datos.emisores.escribir([
      {
        nombre: 'bot-existente',
        token: 'token-secreto-original',
        tipos: ['pendientes'],
        accountId: 'ops',
        vigenciaSegundos: 0
      }
    ]);

    const res = (await post('/emisores/actualizar-tipos', {
      nombre: 'bot-existente',
      tipos: ['pendientes', 'crm-nativo']
    })) as { nombre: string; tipos: string[]; ok: boolean };

    assert.ok(res.ok);
    assert.equal(res.nombre, 'bot-existente');
    assert.deepEqual(res.tipos, ['pendientes', 'crm-nativo']);

    const lista = datos.emisores.leer();
    assert.equal(lista.length, 1);
    assert.deepEqual(lista[0]!.tipos, ['pendientes', 'crm-nativo']);
    assert.equal(
      lista[0]!.token,
      'token-secreto-original',
      'el token no debe cambiar'
    );
  });

  it('actualizar tipos rechaza emisor inexistente', async () => {
    const { post } = await montar();

    await assert.rejects(
      async () =>
        post('/emisores/actualizar-tipos', {
          nombre: 'no-existe',
          tipos: ['pendientes']
        }),
      (err: ErrorPuente) => err.estado === 404
    );
  });

  it('actualizar tipos rechaza lista vacia', async () => {
    const { datos, post } = await montar();
    await datos.emisores.escribir([
      {
        nombre: 'bot-existente',
        token: 'token-secreto',
        tipos: ['pendientes'],
        accountId: 'ops',
        vigenciaSegundos: 0
      }
    ]);

    await assert.rejects(
      async () =>
        post('/emisores/actualizar-tipos', {
          nombre: 'bot-existente',
          tipos: []
        }),
      (err: ErrorPuente) => err.estado === 400
    );
  });

  it('actualizar tipos filtra tipos invalidos', async () => {
    const { datos, post } = await montar();
    await datos.emisores.escribir([
      {
        nombre: 'bot-existente',
        token: 'token-secreto',
        tipos: ['pendientes'],
        accountId: 'ops',
        vigenciaSegundos: 0
      }
    ]);

    const res = (await post('/emisores/actualizar-tipos', {
      nombre: 'bot-existente',
      tipos: ['pendientes', 'tipo-inventado', 'crm-nativo']
    })) as { tipos: string[] };

    assert.deepEqual(
      res.tipos,
      ['pendientes', 'crm-nativo'],
      'tipo-inventado debe ser filtrado'
    );
  });

  it('tipos-disponibles devuelve la lista de tipos validos', async () => {
    const { get } = await montar();

    const res = (await get('/emisores/tipos-disponibles')) as string[];

    assert.ok(Array.isArray(res));
    assert.ok(res.includes('pendientes'));
    assert.ok(res.includes('crm-nativo'));
    assert.ok(res.includes('ejecuciones'));
  });

  it('borrar emisor lo quita de la lista', async () => {
    const { datos, post } = await montar();
    await datos.emisores.escribir([
      {
        nombre: 'bot-a-borrar',
        token: 'token-secreto',
        tipos: ['pendientes'],
        accountId: 'ops',
        vigenciaSegundos: 0
      }
    ]);

    const res = (await post('/emisores/borrar', {
      nombre: 'bot-a-borrar'
    })) as { ok: boolean };

    assert.ok(res.ok);
    assert.equal(datos.emisores.leer().length, 0);
  });
});
