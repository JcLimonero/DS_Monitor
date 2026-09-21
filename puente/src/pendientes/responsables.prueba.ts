import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parametrosEmailJs } from '../acceso/acceso.js';
import {
  decidirAviso,
  depurarSeguidores,
  mismosResponsables,
  textoAviso,
  textoEventoResponsables
} from './responsables.js';

const yo = { id: 'yo', name: 'Yo', email: 'Yo@Nexus.com' };
const ana = { id: 'ana', name: 'Ana', email: 'ana@nexus.com' };
const beto = { id: 'beto', name: 'Beto', email: 'beto@nexus.com' };
const carla = { id: 'carla', name: 'Carla' };

describe('decidir el aviso de responsables', () => {
  it('yo solo: no se manda correo', () => {
    const d = decidirAviso({
      principal: yo,
      seguidores: [],
      sesionCorreo: 'yo@nexus.com'
    });
    assert.equal(d.enviar, false);
    assert.equal(d.motivo, 'eres-tu');
    assert.equal(textoAviso(d, 'enviado'), 'Asignado sin aviso: eres tú.');
  });

  it('yo con seguidores: un correo a mí con copia a ellos', () => {
    const d = decidirAviso({
      principal: yo,
      seguidores: [ana, beto],
      sesionCorreo: 'YO@nexus.com'
    });
    assert.equal(d.enviar, true);
    assert.equal(d.para, yo);
    assert.deepEqual(d.cc, [ana, beto]);
    assert.equal(
      textoAviso(d, 'enviado'),
      'Se avisó a Yo@Nexus.com con copia a ana@nexus.com, beto@nexus.com.'
    );
  });

  it('otro sin seguidores: se le avisa', () => {
    const d = decidirAviso({
      principal: ana,
      seguidores: [],
      sesionCorreo: 'yo@nexus.com'
    });
    assert.equal(d.enviar, true);
    assert.equal(d.para, ana);
    assert.deepEqual(d.cc, []);
    assert.equal(textoAviso(d, 'enviado'), 'Se avisó a ana@nexus.com.');
  });

  it('otro con seguidores: a él con copia; los sin correo no van en copia', () => {
    const d = decidirAviso({
      principal: ana,
      seguidores: [beto, carla, yo],
      sesionCorreo: 'yo@nexus.com'
    });
    assert.equal(d.enviar, true);
    assert.equal(d.para, ana);
    assert.deepEqual(d.cc, [beto, yo]);
  });

  it('sin cambios: ni correo', () => {
    const d = decidirAviso({
      principal: ana,
      seguidores: [beto, { ...yo, email: 'yo@nexus.com' }],
      sesionCorreo: 'yo@nexus.com',
      previo: {
        principal: { ...ana, email: 'ANA@nexus.com' },
        seguidores: [yo, beto]
      }
    });
    assert.equal(d.enviar, false);
    assert.equal(d.motivo, 'sin-cambios');
    assert.equal(textoAviso(d, 'enviado'), 'Sin cambios.');
  });

  it('el principal sale de los seguidores y no se repiten', () => {
    assert.deepEqual(
      depurarSeguidores(ana, [beto, ana, beto, { ...beto, id: 'x' }]),
      [beto]
    );
    const d = decidirAviso({
      principal: ana,
      seguidores: [ana],
      sesionCorreo: 'yo@nexus.com'
    });
    assert.deepEqual(d.cc, []);
  });

  it('sin principal: al primero que siga con copia al resto; sin nadie, no', () => {
    const d = decidirAviso({ seguidores: [carla, ana, beto] });
    assert.equal(d.enviar, true);
    assert.equal(d.para, ana);
    assert.deepEqual(d.cc, [beto]);
    const nadie = decidirAviso({ seguidores: [carla] });
    assert.equal(nadie.enviar, false);
    assert.equal(nadie.motivo, 'nadie');
  });

  it('sin acceso o con error, el aviso lo dice', () => {
    const d = decidirAviso({ principal: ana, seguidores: [] });
    assert.match(textoAviso(d, 'sin-acceso'), /EmailJS/);
    assert.match(
      textoAviso(d, { error: 'EmailJS respondió 400' }),
      /no se pudo mandar el correo: EmailJS respondió 400/
    );
  });
});

describe('comparar responsables', () => {
  it('ignora el orden y las mayúsculas del correo', () => {
    assert.equal(
      mismosResponsables(
        { principal: ana, seguidores: [beto, yo] },
        {
          principal: { ...ana, id: 'otro', email: 'ANA@NEXUS.COM' },
          seguidores: [{ ...yo, email: 'yo@nexus.com' }, beto]
        }
      ),
      true
    );
    assert.equal(
      mismosResponsables({ seguidores: [] }, { seguidores: [] }),
      true
    );
    assert.equal(
      mismosResponsables(
        { principal: ana, seguidores: [] },
        { seguidores: [] }
      ),
      false
    );
    assert.equal(
      mismosResponsables(
        { principal: ana, seguidores: [beto] },
        { principal: ana, seguidores: [] }
      ),
      false
    );
  });
});

describe('el evento de la trazabilidad', () => {
  it('nombra al responsable y a quienes siguen', () => {
    assert.equal(
      textoEventoResponsables(ana, [beto, carla]),
      'Responsable: Ana · seguimiento: Beto, Carla'
    );
    assert.equal(textoEventoResponsables(ana, []), 'Responsable: Ana');
    assert.equal(
      textoEventoResponsables(undefined, [beto]),
      'Sin responsable · seguimiento: Beto'
    );
    assert.equal(textoEventoResponsables(undefined, []), 'Sin responsable');
  });
});

describe('el cliente de EmailJS con copia', () => {
  it('arma cc_email con las copias separadas por coma, sin el destinatario ni repetidos', () => {
    const p = parametrosEmailJs('ana@nexus.com', '', false, {
      titulo: 'Pendiente asignado',
      html: '<p>Hola</p>',
      cc: [
        'beto@nexus.com',
        ' ANA@nexus.com ',
        'beto@nexus.com',
        'sin-arroba',
        'carla@nexus.com'
      ]
    });
    assert.equal(p.to_email, 'ana@nexus.com');
    assert.equal(p.cc_email, 'beto@nexus.com,carla@nexus.com');
    assert.equal(p.html_content, '<p>Hola</p>');
  });

  it('sin copias, cc_email va vacío (como el código de acceso)', () => {
    assert.equal(parametrosEmailJs('ana@nexus.com', '123456').cc_email, '');
    assert.equal(
      parametrosEmailJs('ana@nexus.com', '', false, { titulo: 't', html: 'h' })
        .cc_email,
      ''
    );
  });
});
