import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Cache } from './cache.js';

describe('cache', () => {
  it('devuelve lo guardado mientras siga vigente', async () => {
    let llamadas = 0;
    const cache = new Cache();
    const producir = async () => {
      llamadas++;
      return 'valor';
    };

    assert.equal(await cache.obtener('k', 60, producir), 'valor');
    assert.equal(await cache.obtener('k', 60, producir), 'valor');
    assert.equal(llamadas, 1);
  });

  it('vuelve a pedir cuando vence', async () => {
    let ahora = 1_000;
    let llamadas = 0;
    const cache = new Cache(() => ahora);
    const producir = async () => {
      llamadas++;
      return llamadas;
    };

    assert.equal(await cache.obtener('k', 10, producir), 1);
    ahora += 9_000;
    assert.equal(await cache.obtener('k', 10, producir), 1);
    ahora += 2_000;
    assert.equal(await cache.obtener('k', 10, producir), 2);
  });

  it('dos peticiones a la vez solo pegan una vez al proveedor', async () => {
    // Esto es lo que evita pasarse del limite de Cursor cuando hay varias
    // pestanas del portal abiertas refrescando al mismo tiempo.
    let llamadas = 0;
    const cache = new Cache();
    const producir = async () => {
      llamadas++;
      await new Promise((resolver) => setTimeout(resolver, 20));
      return 'listo';
    };

    const [a, b, c] = await Promise.all([
      cache.obtener('k', 60, producir),
      cache.obtener('k', 60, producir),
      cache.obtener('k', 60, producir)
    ]);

    assert.deepEqual([a, b, c], ['listo', 'listo', 'listo']);
    assert.equal(llamadas, 1);
  });

  it('un fallo no se queda guardado', async () => {
    const cache = new Cache();
    let intento = 0;
    const producir = async () => {
      intento++;
      if (intento === 1) {
        throw new Error('cayo');
      }
      return 'bien';
    };

    await assert.rejects(() => cache.obtener('k', 60, producir));
    // El siguiente intento debe volver a pedir, no servir el error.
    assert.equal(await cache.obtener('k', 60, producir), 'bien');
  });

  it('olvidar tira una llave o todo', async () => {
    const cache = new Cache();
    await cache.obtener('a', 60, async () => 1);
    await cache.obtener('b', 60, async () => 2);
    assert.equal(cache.tamano, 2);

    cache.olvidar('a');
    assert.equal(cache.tamano, 1);

    cache.olvidar();
    assert.equal(cache.tamano, 0);
  });
});
