import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodificarTexto,
  desdoblar,
  fechaImap,
  leerRespuesta
} from './imap.js';

const bytes = (texto: string) => Buffer.from(texto, 'latin1');

describe('leerRespuesta', () => {
  it('junta las respuestas sin etiqueta hasta la etiquetada', () => {
    const leida = leerRespuesta(
      bytes(
        '* 12 EXISTS\r\n* 0 RECENT\r\nA001 OK [READ-ONLY] EXAMINE completed\r\n'
      ),
      'A001'
    );
    assert.ok(leida);
    assert.equal(leida.respuesta.estado, 'OK');
    assert.deepEqual(leida.respuesta.lineas, ['* 12 EXISTS', '* 0 RECENT']);
    assert.equal(leida.consumidos, 64);
  });

  it('un literal con saltos de linea no corta la respuesta', () => {
    const literal = 'Subject: hola\r\nFrom: a@b.c\r\n\r\n';
    const crudo =
      `* 1 FETCH (UID 7 BODY[HEADER.FIELDS (FROM SUBJECT)] {${literal.length}}\r\n` +
      literal +
      ')\r\nA002 OK done\r\n';
    const leida = leerRespuesta(bytes(crudo), 'A002');
    assert.ok(leida);
    assert.equal(leida.respuesta.lineas.length, 1);
    assert.ok(leida.respuesta.lineas[0]?.includes('Subject: hola'));
    assert.ok(leida.respuesta.lineas[0]?.endsWith(')'));
  });

  it('con la respuesta incompleta espera mas datos', () => {
    assert.equal(
      leerRespuesta(bytes('* 1 FETCH (UID 7 {50}\r\nSubj'), 'A003'),
      undefined
    );
    assert.equal(leerRespuesta(bytes('* 12 EXISTS\r\n'), 'A003'), undefined);
  });

  it('deja en el buffer lo que venga despues', () => {
    const leida = leerRespuesta(
      bytes('A004 NO nope\r\n* 1 EXISTS\r\n'),
      'A004'
    );
    assert.equal(leida?.respuesta.estado, 'NO');
    assert.equal(leida?.consumidos, 'A004 NO nope\r\n'.length);
  });
});

describe('desdoblar', () => {
  it('junta las lineas continuadas y baja el nombre a minusculas', () => {
    const campos = desdoblar(
      'Subject: una junta\r\n muy larga\r\nContent-Type: multipart/alternative;\r\n\tboundary="x"\r\n'
    );
    assert.equal(campos['subject'], 'una junta muy larga');
    assert.equal(campos['content-type'], 'multipart/alternative; boundary="x"');
  });
});

describe('decodificarTexto', () => {
  it('lee palabras codificadas en base64 y quoted-printable', () => {
    assert.equal(decodificarTexto('=?UTF-8?B?UmV2aXNpw7Nu?='), 'Revisión');
    assert.equal(
      decodificarTexto('=?utf-8?Q?Revisi=C3=B3n_hoy?='),
      'Revisión hoy'
    );
  });

  it('dos palabras codificadas seguidas no llevan espacio entre si', () => {
    assert.equal(
      decodificarTexto('=?UTF-8?B?UmV2aQ==?= =?UTF-8?B?c2nDs24=?='),
      'Revisión'
    );
  });

  it('el texto sin codificar se toma como UTF-8 crudo', () => {
    assert.equal(
      decodificarTexto(Buffer.from('Reunión').toString('latin1')),
      'Reunión'
    );
  });
});

describe('fechaImap', () => {
  it('escribe la fecha como la pide SEARCH', () => {
    assert.equal(fechaImap(new Date('2026-09-16T12:00:00Z')), '16-Sep-2026');
  });
});
