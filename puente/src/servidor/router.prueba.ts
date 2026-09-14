import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorNoEncontrado } from '../nucleo/errores.js';
import { Router } from './router.js';

const sinParametros = new URLSearchParams();

describe('router', () => {
  it('resuelve una ruta exacta', async () => {
    const router = new Router().get('/vercel/deployments', async () => ['uno']);
    assert.deepEqual(
      await router.resolver('/vercel/deployments', sinParametros),
      ['uno']
    );
  });

  it('no confunde rutas de distinto largo', async () => {
    const router = new Router().get(
      '/vercel/deployments',
      async () => 'despliegues'
    );
    await assert.rejects(
      () => router.resolver('/vercel', sinParametros),
      (error: unknown) => error instanceof ErrorNoEncontrado
    );
    await assert.rejects(
      () => router.resolver('/vercel/deployments/extra', sinParametros),
      (error: unknown) => error instanceof ErrorNoEncontrado
    );
  });

  it('ignora las diagonales de sobra', async () => {
    const router = new Router().get('/salud', async () => 'ok');
    assert.equal(await router.resolver('//salud/', sinParametros), 'ok');
  });

  it('captura los segmentos con dos puntos', async () => {
    const router = new Router().get(
      '/licencias/:proveedor/licenses',
      async ({ segmentos }) => segmentos[1]
    );
    assert.equal(
      await router.resolver('/licencias/cursor/licenses', sinParametros),
      'cursor'
    );
  });

  it('la primera ruta que coincide es la que gana', async () => {
    const router = new Router()
      .get('/licencias/cursor/licenses', async () => 'especifica')
      .get('/licencias/:proveedor/licenses', async () => 'generica');
    assert.equal(
      await router.resolver('/licencias/cursor/licenses', sinParametros),
      'especifica'
    );
  });

  it('una ruta desconocida es 404 y no 500', async () => {
    const router = new Router();
    await assert.rejects(
      () => router.resolver('/no-existe', sinParametros),
      (error: unknown) =>
        error instanceof ErrorNoEncontrado && error.estado === 404
    );
  });
});
