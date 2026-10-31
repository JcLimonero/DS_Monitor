import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FragmentoHallado } from './almacen-vectorial.js';
import { cerrarRespuesta, prepararPregunta } from './preguntar-rag.js';

function fragmento(): FragmentoHallado {
  return {
    id: '1',
    documentoId: 'ff-1',
    orden: 0,
    seccion: 'resumen',
    texto: 'Se reviso el timbrado.',
    empresa: 'dealer-solutions',
    cliente: 'Taller Norte',
    proyecto: 'Portal',
    fecha: '2026-10-06T18:00:00.000Z',
    titulo: 'Revision del portal',
    driveFileId: 'drive-9',
    driveUrl: 'https://drive.google.com/file/d/drive-9/view',
    sensibilidad: 'general',
    puntuacion: 0.03
  };
}

describe('preguntar con citas', () => {
  it('anexa la liga de Drive si el modelo no la cito', () => {
    const f = fragmento();
    const preparado = prepararPregunta('que se acordo', [f]);
    assert.match(
      preparado.usuario,
      /https:\/\/drive\.google\.com\/file\/d\/drive-9\/view/
    );
    assert.match(preparado.sistema, /liga de Drive/);
    const cerrada = cerrarRespuesta(
      'Quedó revisar el timbrado. [1]',
      preparado.fuentes
    );
    assert.match(cerrada.respuesta, /drive-9/);
    assert.equal(cerrada.fuentes[0]?.driveUrl, f.driveUrl);
    assert.equal(cerrada.fuentes[0]?.titulo, 'Revision del portal');
  });

  it('no repite la liga si ya viene en la redaccion', () => {
    const f = fragmento();
    const { fuentes } = prepararPregunta('que se acordo', [f]);
    const cerrada = cerrarRespuesta(`Está en ${f.driveUrl}.`, fuentes);
    assert.equal(cerrada.respuesta, `Está en ${f.driveUrl}.`);
  });
});
