import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import { ErrorPuente } from '../nucleo/errores.js';
import type { Dominio } from '../datos/dominios.js';
import type {
  LicenseAdjustment,
  LicenseUsage,
  ManualLicense
} from '../nucleo/contrato.js';
import { abrirDatos, cargarDatos, construirRutas } from './rutas.js';

/** Las rutas de licencias contra un puente aislado, sin tocar datos reales. */

const dirs: string[] = [];
after(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

interface Estado {
  manuales: ManualLicense[];
  ajustes: Record<string, LicenseAdjustment>;
  renovacion?: { by: string };
}

async function montar() {
  const dir = await mkdtemp(join(tmpdir(), 'puente-lic-'));
  dirs.push(dir);
  const persistencia = new PersistenciaArchivos({
    datos: join(dir, 'datos'),
    ingesta: join(dir, 'ingesta'),
    correo: join(dir, 'correo'),
    integraciones: join(dir, 'integraciones')
  });
  const config = leerConfiguracion({ PUENTE_ADMIN_TOKEN: 'prueba' });
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
  const get = (ruta: string) => router.resolver(ruta, new URLSearchParams());
  return { datos, post, get, persistencia, config, dir };
}

describe('rutas de licencias', () => {
  it('sin token o con uno malo, escribir da 401; leer queda abierto', async () => {
    const { post, get } = await montar();
    for (const ruta of [
      '/licencias/manuales/guardar',
      '/licencias/manuales/borrar',
      '/licencias/ajustes/guardar',
      '/licencias/ajustes/borrar',
      '/licencias/renovar',
      '/licencias/migrar'
    ]) {
      for (const enc of [
        {} as Record<string, string>,
        { authorization: 'Bearer malo' }
      ]) {
        await assert.rejects(
          () => post(ruta, {}, enc),
          (e: unknown) => e instanceof ErrorPuente && e.estado === 401,
          `${ruta} debia dar 401`
        );
      }
    }
    assert.deepEqual(await get('/licencias/manuales'), []);
    assert.deepEqual(await get('/licencias/ajustes'), {});
  });

  it('alta, edicion y borrado de una licencia a mano', async () => {
    const { post, get } = await montar();
    await assert.rejects(
      () =>
        post('/licencias/manuales/guardar', { licencia: { accountId: 'a' } }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
    const alta = (await post('/licencias/manuales/guardar', {
      licencia: { product: 'Claude Max', accountId: 'itech', cost: 100 }
    })) as ManualLicense;
    assert.match(alta.id, /^manual-claude-max-/);
    assert.equal(((await get('/licencias/manuales')) as unknown[]).length, 1);

    const edicion = (await post('/licencias/manuales/guardar', {
      licencia: {
        id: alta.id,
        product: 'Claude Max',
        accountId: 'itech',
        cost: 250
      }
    })) as ManualLicense;
    assert.equal(edicion.id, alta.id);
    assert.equal(edicion.cost, 250);
    assert.equal(((await get('/licencias/manuales')) as unknown[]).length, 1);

    const borrado = (await post('/licencias/manuales/borrar', {
      id: alta.id
    })) as Estado;
    assert.equal(borrado.manuales.length, 0);
    await assert.rejects(
      () => post('/licencias/manuales/borrar', { id: alta.id }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 404
    );
  });

  it('renovar exige fecha, registra quien y cuando, y actualiza la licencia a mano', async () => {
    const { post, get } = await montar();
    const alta = (await post('/licencias/manuales/guardar', {
      licencia: {
        product: 'Hosting',
        accountId: 'itech',
        cost: 100,
        renewsAt: '2026-10-01'
      }
    })) as ManualLicense;
    await assert.rejects(
      () => post('/licencias/renovar', { id: alta.id, costo: 120 }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
    const proxima = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const r = (await post('/licencias/renovar', {
      id: alta.id,
      costo: 120,
      moneda: 'USD',
      renuevaEn: proxima,
      nota: 'subió'
    })) as Estado;
    assert.equal(r.renovacion?.by, 'admin');
    const m = r.manuales[0] as ManualLicense;
    assert.equal(m.cost, 120);
    assert.equal(m.currency, 'USD');
    assert.equal(m.renewsAt?.slice(0, 10), proxima);
    assert.ok(m.renewedAt);
    const ajustes = (await get('/licencias/ajustes')) as Record<
      string,
      LicenseAdjustment
    >;
    assert.equal(ajustes[alta.id]?.history.length, 1);
    assert.equal(ajustes[alta.id]?.history[0]?.note, 'subió');
  });

  it('renovar una licencia de proveedor guarda el ajuste y alertas/resumen lo ven', async () => {
    const { post, datos } = await montar();
    const proxima = new Date(Date.now() + 40 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await post('/licencias/renovar', {
      id: 'cursor-1',
      costo: 90,
      renuevaEn: proxima
    });
    // Una segunda confirmacion suma al historial.
    await post('/licencias/renovar', { id: 'cursor-1', renuevaEn: proxima });
    const a = datos.licenciasAjustes.leer()['cursor-1'] as LicenseAdjustment;
    assert.equal(a.history.length, 2);
    assert.equal(a.cost, 90);
    assert.equal(a.renewsAt?.slice(0, 10), proxima);
  });

  it('renovar un dominio mueve su fecha y su costo, que es de donde sale su licencia', async () => {
    const { post, datos } = await montar();
    const dominio: Dominio = {
      nombre: 'ejemplo.com.mx',
      venceEn: '2026-10-03T00:00:00.000Z',
      costo: 300,
      moneda: 'MXN'
    };
    await datos.dominios.escribir([dominio]);
    const proxima = new Date(Date.now() + 365 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await post('/licencias/renovar', {
      id: 'dominios-ejemplo-com-mx',
      costo: 350,
      renuevaEn: proxima
    });
    const d = datos.dominios.leer()[0] as Dominio;
    assert.equal(d.costo, 350);
    assert.equal(d.venceEn.slice(0, 10), proxima);
    const a = datos.licenciasAjustes.leer()['dominios-ejemplo-com-mx'];
    assert.equal(a?.renewsAt, undefined);
    assert.equal(a?.history.length, 1);
  });

  it('ajustes: corregir, ocultar y quitar la correccion', async () => {
    const { post, get } = await montar();
    const r = (await post('/licencias/ajustes/guardar', {
      id: 'figma-1',
      cost: 40,
      currency: 'usd',
      hidden: true
    })) as Estado;
    assert.equal(r.ajustes['figma-1']?.cost, 40);
    assert.equal(r.ajustes['figma-1']?.currency, 'USD');
    assert.equal(r.ajustes['figma-1']?.hidden, true);
    await assert.rejects(
      () => post('/licencias/ajustes/guardar', { id: 'figma-1', cost: -1 }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
    const quitado = (await post('/licencias/ajustes/borrar', {
      id: 'figma-1'
    })) as Estado;
    assert.deepEqual(quitado.ajustes, {});
    assert.deepEqual(await get('/licencias/ajustes'), {});
  });

  it('un ajuste sobre una licencia a mano corrige la licencia misma', async () => {
    const { post } = await montar();
    const alta = (await post('/licencias/manuales/guardar', {
      licencia: { product: 'Hosting', accountId: 'itech', cost: 100 }
    })) as ManualLicense;
    const r = (await post('/licencias/ajustes/guardar', {
      id: alta.id,
      cost: 175
    })) as Estado;
    assert.equal(r.manuales[0]?.cost, 175);
    assert.equal(r.ajustes[alta.id], undefined);
  });

  it('migrar sube lo del navegador sin duplicar al repetirlo', async () => {
    const { post } = await montar();
    const cuerpo = {
      manuales: [
        {
          id: 'manual-aaaa-1111',
          product: 'Antigua',
          accountId: 'itech',
          provider: 'otro',
          cost: 10,
          currency: 'MXN',
          renewsAt: '2026-12-01T12:00:00.000Z'
        }
      ],
      ajustes: { 'cursor-1': { cost: 55, hidden: false } }
    };
    const una = (await post('/licencias/migrar', cuerpo)) as Estado & {
      migradas: number;
    };
    assert.equal(una.migradas, 2);
    assert.equal(una.manuales[0]?.id, 'manual-aaaa-1111');
    const dos = (await post('/licencias/migrar', cuerpo)) as typeof una;
    assert.equal(dos.migradas, 0);
    assert.equal(dos.manuales.length, 1);
  });

  it('las licencias que ven las alertas ya traen la fecha confirmada', async () => {
    const { post, datos } = await montar();
    const alta = (await post('/licencias/manuales/guardar', {
      licencia: {
        product: 'Hosting',
        accountId: 'itech',
        cost: 100,
        renewsAt: new Date(Date.now() + 2 * 86_400_000)
          .toISOString()
          .slice(0, 10)
      }
    })) as ManualLicense;
    const { aplicarAjustes } = await import('../datos/licencias.js');
    const antes = aplicarAjustes(
      [],
      datos.licenciasManuales.leer(),
      datos.licenciasAjustes.leer(),
      new Date()
    ) as LicenseUsage[];
    assert.equal(antes.length, 1);
    const lejos = new Date(Date.now() + 33 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await post('/licencias/renovar', { id: alta.id, renuevaEn: lejos });
    const despues = aplicarAjustes(
      [],
      datos.licenciasManuales.leer(),
      datos.licenciasAjustes.leer(),
      new Date()
    );
    assert.equal(despues[0]?.renewsAt?.slice(0, 10), lejos);
  });
});

describe('licencias: serializacion, topes e ids', () => {
  const futuro = (dias: number) =>
    new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

  it('10 renovaciones simultaneas de ids distintos no se pierden', async () => {
    const { post, datos } = await montar();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post('/licencias/renovar', {
          id: `cursor-${i}`,
          costo: i + 1,
          renuevaEn: futuro(30)
        })
      )
    );
    const ajustes = datos.licenciasAjustes.leer();
    assert.equal(Object.keys(ajustes).length, 10);
    for (let i = 0; i < 10; i++) {
      assert.equal(ajustes[`cursor-${i}`]?.history.length, 1);
      assert.equal(ajustes[`cursor-${i}`]?.cost, i + 1);
    }
  });

  it('30 renovaciones simultaneas del mismo id: ninguna se pierde, historial en 24', async () => {
    const { post, datos } = await montar();
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        post('/licencias/renovar', {
          id: 'figma-1',
          nota: `n${i}`,
          renuevaEn: futuro(30)
        })
      )
    );
    const h = datos.licenciasAjustes.leer()['figma-1']?.history ?? [];
    assert.equal(h.length, 24);
    // Las 6 mas viejas salieron; las 24 ultimas estan todas (en el orden en que llegaron).
    assert.deepEqual(
      h.map((x) => x.note),
      Array.from({ length: 24 }, (_, i) => `n${i + 6}`)
    );
  });

  it('las altas y borrados simultaneos tampoco se pisan', async () => {
    const { post, datos } = await montar();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        post('/licencias/manuales/guardar', {
          licencia: { product: `Licencia ${i}`, accountId: 'itech' }
        })
      )
    );
    assert.equal(datos.licenciasManuales.leer().length, 8);
  });

  it('topes: 200 licencias a mano y 500 ajustes', async () => {
    const { post, datos } = await montar();
    const llenas = Array.from(
      { length: 200 },
      (_, i) =>
        ({
          id: `manual-lleno-${i}`,
          provider: 'otro',
          product: `L${i}`,
          unit: 'dinero',
          used: 0,
          periodStart: '2026-10-01T12:00:00.000Z',
          periodEnd: '2026-11-01T12:00:00.000Z',
          renewsAt: '2026-11-01T12:00:00.000Z',
          manual: true,
          members: [],
          accountId: 'itech',
          updatedAt: '2026-10-01T12:00:00.000Z',
          period: 'mensual'
        }) as ManualLicense
    );
    await datos.licenciasManuales.escribir(llenas);
    await assert.rejects(
      () =>
        post('/licencias/manuales/guardar', {
          licencia: { product: 'Una mas', accountId: 'itech' }
        }),
      (e: unknown) =>
        e instanceof ErrorPuente && e.estado === 400 && /200/.test(e.message)
    );
    // Editar una existente sigue valiendo.
    const ok = (await post('/licencias/manuales/guardar', {
      licencia: { id: 'manual-lleno-3', product: 'Editada', accountId: 'itech' }
    })) as ManualLicense;
    assert.equal(ok.product, 'Editada');

    const ajustes: Record<string, LicenseAdjustment> = {};
    for (let i = 0; i < 500; i++) {
      ajustes[`prov-${i}`] = { cost: 1, history: [] };
    }
    await datos.licenciasAjustes.escribir(ajustes);
    await assert.rejects(
      () => post('/licencias/ajustes/guardar', { id: 'prov-nuevo', cost: 5 }),
      (e: unknown) =>
        e instanceof ErrorPuente && e.estado === 400 && /500/.test(e.message)
    );
    await assert.rejects(
      () =>
        post('/licencias/renovar', {
          id: 'prov-nuevo',
          renuevaEn: futuro(30)
        }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 400
    );
    // Uno existente se puede seguir corrigiendo.
    await post('/licencias/ajustes/guardar', { id: 'prov-7', cost: 9 });
    assert.equal(datos.licenciasAjustes.leer()['prov-7']?.cost, 9);
  });

  it('ids: longitud y caracteres validos; inexistentes de manual o dominio dan 404', async () => {
    const { post } = await montar();
    for (const id of ['con espacios', 'a'.repeat(121), 'x/y', '']) {
      await assert.rejects(
        () => post('/licencias/ajustes/guardar', { id, cost: 1 }),
        (e: unknown) => e instanceof ErrorPuente && e.estado === 400,
        `id "${id.slice(0, 20)}" debia dar 400`
      );
    }
    await assert.rejects(
      () => post('/licencias/ajustes/guardar', { id: 'manual-nope', cost: 1 }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 404
    );
    await assert.rejects(
      () =>
        post('/licencias/renovar', {
          id: 'manual-nope',
          renuevaEn: futuro(30)
        }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 404
    );
    await assert.rejects(
      () =>
        post('/licencias/renovar', {
          id: 'dominios-nope-com',
          renuevaEn: futuro(30)
        }),
      (e: unknown) => e instanceof ErrorPuente && e.estado === 404
    );
    // Una de proveedor (no verificable) se acepta.
    await post('/licencias/ajustes/guardar', {
      id: 'cursor-asientos',
      cost: 5
    });
  });

  it('migrar por la ruta devuelve el resumen y no se cae con datos viejos sucios', async () => {
    const { post } = await montar();
    const r = (await post('/licencias/migrar', {
      manuales: [
        {
          id: 'manual-aaaa-1111',
          product: 'Vieja',
          accountId: 'itech',
          currency: '$'
        },
        { product: '', accountId: 'itech' }
      ],
      ajustes: { 'cursor-1': { cost: 55, currency: '$' } }
    })) as Estado & {
      migradas: number;
      saneadas: { id: string; campo: string }[];
      descartadas: { id: string }[];
    };
    assert.equal(r.migradas, 2);
    assert.equal(r.saneadas.length, 2);
    assert.equal(r.descartadas.length, 1);
    assert.equal(r.manuales[0]?.currency, 'MXN');
  });
});
