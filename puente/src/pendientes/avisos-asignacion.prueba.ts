import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { acotarConfianza, correosDelPara } from '../ia/pendientes.js';
import {
  claveDeAviso,
  registrarAviso,
  yaAvisado
} from './avisos-asignacion.js';

describe('avisos de asignación sin repetir por buzón', () => {
  const ahora = new Date('2026-09-21T10:00:00Z');

  it('la clave junta persona y título sin RE:/RV: ni mayúsculas', () => {
    assert.equal(
      claveDeAviso('Carlos@Nexus.com', 'RV: Re: Your Paddle invoice', 'x'),
      'carlos@nexus.com|your paddle invoice'
    );
    assert.equal(
      claveDeAviso('carlos@nexus.com', 'Your Paddle invoice', 'y'),
      'carlos@nexus.com|your paddle invoice'
    );
    // Sin título, el id para no juntar cosas distintas.
    assert.equal(claveDeAviso('a@b.c', '', 'id-1'), 'a@b.c|id-1');
  });

  it('el mismo aviso a la misma persona en 24 h no se repite; a otra sí', () => {
    const clave = claveDeAviso('carlos@nexus.com', 'Paddle invoice', '1');
    const registro = registrarAviso({}, clave, ahora);
    assert.equal(yaAvisado(registro, clave, ahora), true);
    assert.equal(
      yaAvisado(registro, clave, new Date(ahora.getTime() + 23 * 3_600_000)),
      true
    );
    assert.equal(
      yaAvisado(registro, clave, new Date(ahora.getTime() + 25 * 3_600_000)),
      false
    );
    assert.equal(
      yaAvisado(
        registro,
        claveDeAviso('ana@nexus.com', 'Paddle invoice', '2'),
        ahora
      ),
      false
    );
  });

  it('limpia lo de más de 7 días al registrar', () => {
    const viejo = registrarAviso(
      {},
      'a|viejo',
      new Date(ahora.getTime() - 8 * 24 * 3_600_000)
    );
    const reciente = registrarAviso(
      viejo,
      'a|reciente',
      new Date(ahora.getTime() - 2 * 24 * 3_600_000)
    );
    const nuevo = registrarAviso(reciente, 'a|nuevo', ahora);
    assert.deepEqual(Object.keys(nuevo).sort(), ['a|nuevo', 'a|reciente']);
  });
});

describe('el dueño del buzón no es evidencia', () => {
  const equipo = [
    { id: 'carlos', email: 'Carlos@Nexus.com' },
    { id: 'ana', email: 'ana@nexus.com' },
    { id: 'beto' }
  ];

  it('proponer al dueño con confianza alta baja a media', () => {
    const s = acotarConfianza(
      {
        responsable: 'carlos',
        motivo: 'Carlos es el destinatario del correo',
        confianza: 'alta'
      },
      equipo,
      { correo: 'carlos@nexus.com' }
    );
    assert.equal(s.confianza, 'media');
    assert.match(s.motivo, /dueño del buzón/);
  });

  it('también si el dueño solo se sabe por el "Para:" del correo', () => {
    const s = acotarConfianza(
      { responsable: 'carlos', motivo: 'x', confianza: 'alta' },
      equipo,
      undefined,
      correosDelPara(
        'De: Paddle <no-reply@paddle.com>\nPara: Carlos <carlos@nexus.com>, otro@x.com\nAsunto: Invoice'
      )
    );
    assert.equal(s.confianza, 'media');
  });

  it('otra persona, o sin correo, o ya media: no cambia', () => {
    const ana = {
      responsable: 'ana',
      motivo: 'el correo la nombra',
      confianza: 'alta' as const
    };
    assert.deepEqual(
      acotarConfianza(ana, equipo, { correo: 'carlos@nexus.com' }),
      ana
    );
    const beto = {
      responsable: 'beto',
      motivo: 'x',
      confianza: 'alta' as const
    };
    assert.deepEqual(
      acotarConfianza(beto, equipo, { correo: 'carlos@nexus.com' }),
      beto
    );
    const media = {
      responsable: 'carlos',
      motivo: 'x',
      confianza: 'media' as const
    };
    assert.deepEqual(
      acotarConfianza(media, equipo, { correo: 'carlos@nexus.com' }),
      media
    );
  });

  it('saca los correos del "Para:"', () => {
    assert.deepEqual(
      correosDelPara(
        'De: a@b.c\nPara: "Carlos" <CARLOS@nexus.com>; ana@nexus.com\nAsunto: x'
      ),
      ['carlos@nexus.com', 'ana@nexus.com']
    );
    assert.deepEqual(correosDelPara(undefined), []);
  });
});
