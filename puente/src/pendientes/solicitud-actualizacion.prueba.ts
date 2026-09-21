import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { anotar, type Anotacion } from './anotaciones.js';
import { marcarVisto } from './relacionar.js';
import {
  SOLICITUD_REPETIDA_MS,
  conRespuesta,
  conSolicitud,
  destinatariosSolicitud,
  motivoSinDestinatario,
  solicitudReciente,
  textoEventoSolicitud,
  textoNovedadRespuesta
} from './solicitud-actualizacion.js';

const yo = { id: 'yo', name: 'Yo', email: 'Yo@Nexus.com' };
const ana = { id: 'ana', name: 'Ana', email: 'ana@nexus.com' };
const beto = { id: 'beto', name: 'Beto', email: 'beto@nexus.com' };
const carla = { id: 'carla', name: 'Carla' };
const vacia = (): Anotacion => ({ comentarios: [], actualizadoEn: '' });

describe('a quien se le pide la actualizacion', () => {
  it('responsable de destinatario y seguidores con copia', () => {
    const d = destinatariosSolicitud({
      principal: ana,
      seguidores: [beto, carla],
      propios: ['yo@nexus.com']
    });
    assert.equal(d.motivo, undefined);
    assert.equal(d.para, ana);
    assert.deepEqual(d.cc, [beto]);
    assert.equal(
      textoEventoSolicitud(d.para as typeof ana, d.cc),
      'Solicitó actualización a Ana (cc Beto)'
    );
  });

  it('sin responsable, el primer seguidor es el destinatario', () => {
    const d = destinatariosSolicitud({
      seguidores: [beto, ana],
      propios: ['yo@nexus.com']
    });
    assert.equal(d.para, beto);
    assert.deepEqual(d.cc, [ana]);
    assert.equal(
      textoEventoSolicitud(beto, []),
      'Solicitó actualización a Beto'
    );
  });

  it('es mio y nadie mas sigue: no hay a quien pedirle', () => {
    const d = destinatariosSolicitud({
      principal: yo,
      seguidores: [],
      propios: ['YO@nexus.com']
    });
    assert.equal(d.motivo, 'eres-tu');
    assert.equal(
      motivoSinDestinatario('eres-tu'),
      'Es tuyo; no hay a quién pedirle.'
    );
  });

  it('es mio pero alguien sigue: se le pide a quien sigue', () => {
    const d = destinatariosSolicitud({
      principal: yo,
      seguidores: [ana],
      propios: ['yo@nexus.com']
    });
    assert.equal(d.para, ana);
    assert.deepEqual(d.cc, []);
  });

  it('sin nadie, o sin correos, no se puede', () => {
    assert.equal(destinatariosSolicitud({ propios: [] }).motivo, 'nadie');
    assert.equal(
      destinatariosSolicitud({ principal: carla, propios: [] }).motivo,
      'sin-correo'
    );
  });

  it('el mismo repetido como responsable y seguidor cuenta una vez', () => {
    const d = destinatariosSolicitud({
      principal: ana,
      seguidores: [{ id: 'otro', name: 'Ana', email: 'ANA@nexus.com' }],
      propios: []
    });
    assert.equal(d.para, ana);
    assert.deepEqual(d.cc, []);
  });
});

describe('no se repite la solicitud antes de dos horas', () => {
  const ahora = new Date('2026-09-21T15:00:00.000Z');
  it('sin solicitud previa se puede pedir', () => {
    assert.equal(solicitudReciente(undefined, ahora), undefined);
    assert.equal(solicitudReciente(vacia(), ahora), undefined);
  });

  it('hace 25 minutos: todavia no', () => {
    const nota = conSolicitud(vacia(), {
      para: ana,
      cc: [],
      por: 'yo@nexus.com',
      ahora: new Date(ahora.getTime() - 25 * 60_000).toISOString()
    });
    assert.equal(solicitudReciente(nota, ahora), 25);
  });

  it('pasadas las dos horas se puede volver a pedir', () => {
    const nota = conSolicitud(vacia(), {
      para: ana,
      cc: [],
      por: 'yo@nexus.com',
      ahora: new Date(ahora.getTime() - SOLICITUD_REPETIDA_MS).toISOString()
    });
    assert.equal(solicitudReciente(nota, ahora), undefined);
  });
});

describe('la solicitud en la nota y en la tarea', () => {
  it('guarda a quienes se les pidio y deja el movimiento', () => {
    const nota = conSolicitud(vacia(), {
      para: ana,
      cc: [beto, carla],
      por: 'yo@nexus.com',
      ahora: '2026-09-21T15:00:00.000Z'
    });
    assert.deepEqual(nota.solicitudActualizacion, {
      at: '2026-09-21T15:00:00.000Z',
      por: 'yo@nexus.com',
      a: ['ana@nexus.com', 'beto@nexus.com']
    });
    const evento = nota.historial?.at(-1);
    assert.equal(evento?.kind, 'solicitud');
    assert.equal(evento?.by, 'yo@nexus.com');
    assert.equal(evento?.text, 'Solicitó actualización a Ana (cc Beto, Carla)');
    const tarea = anotar([{ id: 't1', title: 'X' } as TaskItem], {
      t1: nota
    })[0];
    assert.deepEqual(tarea?.updateRequested, {
      at: '2026-09-21T15:00:00.000Z',
      to: ['ana@nexus.com', 'beto@nexus.com']
    });
  });
});

describe('la respuesta del equipo es novedad', () => {
  it('texto: comentario, o el estado si no hubo comentario', () => {
    assert.equal(
      textoNovedadRespuesta({
        nombre: 'Ana',
        comentario: ' Ya casi ',
        respondeSolicitud: false
      }),
      'Ana: Ya casi'
    );
    assert.equal(
      textoNovedadRespuesta({
        nombre: 'Ana',
        estado: 'en_progreso',
        respondeSolicitud: false
      }),
      'Ana: cambió a En progreso'
    );
    assert.equal(
      textoNovedadRespuesta({
        nombre: 'Ana',
        comentario: 'Listo',
        estado: 'hecho',
        respondeSolicitud: true
      }),
      'Respondió a tu solicitud: Ana: Listo'
    );
  });

  it('con solicitud pendiente: la borra, deja novedad y movimiento', () => {
    const pedida = conSolicitud(vacia(), {
      para: ana,
      cc: [],
      por: 'yo@nexus.com',
      ahora: '2026-09-21T15:00:00.000Z'
    });
    const nota = conRespuesta(pedida, {
      persona: ana,
      comentario: 'Va al 80 %',
      ahora: '2026-09-21T16:00:00.000Z'
    });
    assert.equal(nota.solicitudActualizacion, undefined);
    assert.deepEqual(nota.novedad, {
      at: '2026-09-21T16:00:00.000Z',
      kind: 'respuesta',
      text: 'Respondió a tu solicitud: Ana: Va al 80 %'
    });
    assert.equal(
      nota.historial?.at(-1)?.text,
      'Respondió a la solicitud de actualización'
    );
    const tarea = anotar([{ id: 't1', title: 'X' } as TaskItem], {
      t1: nota
    })[0];
    assert.equal(tarea?.updateRequested, undefined);
    assert.equal(tarea?.unread?.kind, 'respuesta');
  });

  it('sin solicitud tambien es novedad, sin movimiento extra', () => {
    const nota = conRespuesta(vacia(), {
      persona: beto,
      estado: 'bloqueado',
      ahora: '2026-09-21T16:00:00.000Z'
    });
    assert.equal(nota.novedad?.text, 'Beto: cambió a Bloqueado');
    assert.equal(nota.historial, undefined);
  });

  it('sin comentario ni estado no cambia nada', () => {
    const nota = vacia();
    assert.equal(
      conRespuesta(nota, { persona: ana, ahora: '2026-09-21T16:00:00.000Z' }),
      nota
    );
  });

  it('verla (marcarVisto) quita solo la novedad', () => {
    const nota: Anotacion = {
      ...conRespuesta(vacia(), {
        persona: ana,
        comentario: 'Hola',
        ahora: '2026-09-21T16:00:00.000Z'
      }),
      asignado: ana
    };
    const vista = marcarVisto(nota);
    assert.equal(vista?.novedad, undefined);
    assert.equal(vista?.asignado, ana);
    assert.equal(vista?.comentarios, nota.comentarios);
  });
});
