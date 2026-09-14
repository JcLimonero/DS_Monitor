import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { AlmacenIngesta, mezclarPorId, origenValido } from './almacen.js';

describe('almacén de lo recibido', () => {
  let directorio: string;

  beforeEach(async () => {
    directorio = await mkdtemp(join(tmpdir(), 'ingesta-'));
  });

  afterEach(async () => {
    await rm(directorio, { recursive: true, force: true });
  });

  it('guarda y devuelve un envío', async () => {
    const almacen = new AlmacenIngesta(directorio);
    const resultado = await almacen.guardar(
      'pendientes',
      'ops',
      'reemplazar',
      '2026-09-14T10:00:00Z',
      [{ id: 'a' }, { id: 'b' }]
    );
    assert.equal(resultado.guardado, true);
    assert.equal(almacen.leer('pendientes', 'ops')?.elementos.length, 2);
  });

  it('sobrevive a un reinicio', async () => {
    const primero = new AlmacenIngesta(directorio);
    await primero.guardar(
      'pendientes',
      'ops',
      'reemplazar',
      '2026-09-14T10:00:00Z',
      [{ id: 'a' }]
    );

    // Con push, perder lo recibido en un reinicio deja el portal en blanco
    // hasta el siguiente envío, que puede tardar horas.
    const segundo = new AlmacenIngesta(directorio);
    const cargados = await segundo.cargar();
    assert.equal(cargados, 1);
    assert.equal(segundo.leer('pendientes', 'ops')?.elementos.length, 1);
  });

  it('no deja que un envío viejo pise a uno nuevo', async () => {
    const almacen = new AlmacenIngesta(directorio);
    await almacen.guardar(
      'pendientes',
      'ops',
      'reemplazar',
      '2026-09-14T10:00:00Z',
      [{ id: 'nuevo' }]
    );
    const resultado = await almacen.guardar(
      'pendientes',
      'ops',
      'reemplazar',
      '2026-09-14T09:00:00Z',
      [{ id: 'viejo' }]
    );

    assert.equal(resultado.guardado, false);
    assert.match(resultado.motivo ?? '', /anterior al último recibido/);
    assert.equal(
      almacen.leer<{ id: string }>('pendientes', 'ops')?.elementos[0]?.id,
      'nuevo'
    );
  });

  it('en modo agregar mezcla en vez de borrar', async () => {
    const almacen = new AlmacenIngesta(directorio);
    await almacen.guardar(
      'despliegues',
      'ci',
      'reemplazar',
      '2026-09-14T10:00:00Z',
      [{ id: 'a' }, { id: 'b' }]
    );
    // Un webhook de un solo despliegue en modo reemplazar borraría los otros.
    await almacen.guardar(
      'despliegues',
      'ci',
      'agregar',
      '2026-09-14T11:00:00Z',
      [{ id: 'c' }]
    );

    const ids = almacen
      .leer<{ id: string }>('despliegues', 'ci')
      ?.elementos.map((e) => e.id);
    assert.deepEqual(ids, ['a', 'b', 'c']);
  });

  it('mezclar respeta el orden previo y actualiza en su lugar', () => {
    const mezclado = mezclarPorId(
      [
        { id: 'a', v: 1 },
        { id: 'b', v: 1 }
      ],
      [
        { id: 'b', v: 2 },
        { id: 'c', v: 1 }
      ]
    );
    assert.deepEqual(mezclado, [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
      { id: 'c', v: 1 }
    ]);
  });

  it('reporta la frescura y qué venció', async () => {
    let ahora = Date.parse('2026-09-14T12:00:00Z');
    const almacen = new AlmacenIngesta(directorio, () => new Date(ahora));
    await almacen.guardar(
      'pendientes',
      'ops',
      'reemplazar',
      '2026-09-14T11:00:00Z',
      [{ id: 'a' }]
    );

    const vigencias = new Map([['ops', 7200]]);
    assert.equal(almacen.estado(vigencias)[0]?.vencido, false);
    assert.equal(almacen.estado(vigencias)[0]?.edadSegundos, 3600);

    ahora = Date.parse('2026-09-14T14:00:00Z');
    assert.equal(almacen.estado(vigencias)[0]?.vencido, true);
    // Vigencia 0 quiere decir que nunca vence.
    assert.equal(almacen.estado(new Map([['ops', 0]]))[0]?.vencido, false);
  });

  it('rechaza nombres de origen que no sirven de nombre de archivo', () => {
    assert.equal(origenValido('ops'), true);
    assert.equal(origenValido('calendario-trabajo'), true);
    assert.equal(origenValido('../../etc/passwd'), false);
    assert.equal(origenValido('con espacio'), false);
    assert.equal(origenValido(''), false);
  });
});
