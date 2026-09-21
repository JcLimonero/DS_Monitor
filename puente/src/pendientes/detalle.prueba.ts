import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  esFotoDataUrl,
  limpiarDescripcion,
  limpiarImagenes,
  limpiarPendienteLocal,
  limpiarPersona
} from './detalle.js';

const jpeg =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//Z';

describe('limpiarDescripcion', () => {
  it('conserva saltos de línea y recorta bordes', () => {
    assert.equal(
      limpiarDescripcion('  primera\n\nsegunda renglón  \n'),
      'primera\n\nsegunda renglón'
    );
  });

  it('no colapsa a un renglón', () => {
    const texto = limpiarDescripcion('uno\ndos\ntres');
    assert.equal(texto?.includes('\n'), true);
    assert.equal(texto, 'uno\ndos\ntres');
  });

  it('vacío o no texto no cuenta', () => {
    assert.equal(limpiarDescripcion('   \n  '), undefined);
    assert.equal(limpiarDescripcion(3), undefined);
  });
});

describe('limpiarImagenes', () => {
  it('acepta un jpeg en data URL y descarta basura', () => {
    const fotos = limpiarImagenes([
      jpeg,
      'http://evil.example/x.png',
      1,
      'data:text/plain;base64,QQ=='
    ]);
    assert.deepEqual(fotos, [jpeg]);
    assert.equal(esFotoDataUrl(jpeg), true);
  });

  it('normaliza image/jpg a jpeg', () => {
    const cruda = jpeg.replace('image/jpeg', 'image/jpg');
    assert.equal(
      limpiarImagenes([cruda])?.[0]?.startsWith('data:image/jpeg;base64,'),
      true
    );
  });

  it('sin fotos válidas no deja el campo', () => {
    assert.equal(limpiarImagenes([]), undefined);
    assert.equal(limpiarImagenes('no'), undefined);
  });
});

describe('limpiarPendienteLocal', () => {
  const ahora = '2026-09-21T15:00:00.000Z';

  it('guarda detalle, fotos, fecha y hora', () => {
    const t = limpiarPendienteLocal(
      {
        id: 'local-abc',
        title: '  Revisar corte  ',
        description: 'Paso 1\nPaso 2',
        imagenes: [jpeg],
        priority: 'alta',
        dueDate: '2026-09-22T18:00:00.000Z',
        dueHasTime: true,
        company: 'Dealer Solutions'
      },
      0,
      ahora
    );
    assert.equal(t.title, 'Revisar corte');
    assert.equal(t.description, 'Paso 1\nPaso 2');
    assert.deepEqual(t.imagenes, [jpeg]);
    assert.equal(t.dueDate, '2026-09-22T18:00:00.000Z');
    assert.equal(t.dueHasTime, true);
    assert.equal(t.company, 'Dealer Solutions');
    assert.equal(t.origin, 'local');
    assert.equal(t.assignee, undefined);
  });

  it('lo personal con fecha es urgente', () => {
    const t = limpiarPendienteLocal(
      {
        title: 'Llamar al dentista',
        personal: true,
        dueDate: '2026-09-23T12:00:00.000Z',
        dueHasTime: false
      },
      0,
      ahora
    );
    assert.equal(t.personal, true);
    assert.equal(t.priority, 'urgente');
    assert.equal(t.dueHasTime, undefined);
  });

  it('sin título no pasa', () => {
    assert.throws(
      () => limpiarPendienteLocal({ title: '  ' }, 3, ahora),
      /pendientes\[3\]\.title es obligatorio/
    );
  });
});

describe('limpiarPersona', () => {
  it('pide al menos nombre, id o correo', () => {
    assert.equal(limpiarPersona({}), undefined);
    assert.deepEqual(
      limpiarPersona({ id: 'ana', name: 'Ana', email: 'ana@x.com' }),
      {
        id: 'ana',
        name: 'Ana',
        email: 'ana@x.com',
        role: undefined
      }
    );
  });
});
