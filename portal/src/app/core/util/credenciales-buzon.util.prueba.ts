import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { credencialesParaGuardar } from './credenciales-buzon.util';

const ID = '22222222-2222-4222-8222-222222222222';

describe('credencialesParaGuardar', () => {
  it('en Microsoft manda el ID y el secreto escritos', () => {
    const r = credencialesParaGuardar({
      proveedor: 'microsoft',
      usuario: 'a@falso.test',
      tenant: 'common',
      clientId: ` ${ID} `,
      clientSecret: 'secreto-falso~1',
      puerto: 993
    });
    assert.equal(r.clientId, ID);
    assert.equal(r.clientSecret, 'secreto-falso~1');
    assert.equal(r.tenant, 'common');
    assert.equal(r.puerto, 993);
  });

  it('secreto vacío = sin cambio: no viaja', () => {
    const r = credencialesParaGuardar({
      proveedor: 'microsoft',
      usuario: 'a@falso.test',
      tenant: 'common',
      clientId: ID,
      clientSecret: ''
    });
    assert.ok(!('clientSecret' in r));
    assert.equal(r.clientId, ID);
  });

  it('un espacio en el secreto llega tal cual (quitar la aplicación)', () => {
    const r = credencialesParaGuardar({
      proveedor: 'microsoft',
      tenant: 'common',
      clientId: ID,
      clientSecret: ' '
    });
    assert.equal(r.clientSecret, ' ');
  });

  it('sin aplicación propia no manda ID ni secreto vacíos', () => {
    const r = credencialesParaGuardar({
      proveedor: 'microsoft',
      tenant: 'common',
      clientId: '',
      clientSecret: ''
    });
    assert.ok(!('clientId' in r));
    assert.ok(!('clientSecret' in r));
  });

  it('en IMAP y Google nunca viajan ID, secreto ni tenant', () => {
    for (const proveedor of ['imap', 'google'] as const) {
      const r = credencialesParaGuardar({
        proveedor,
        usuario: 'a@falso.test',
        tenant: 'common',
        clientId: ID,
        clientSecret: 'secreto-falso~1',
        contrasena: 'x'
      });
      assert.ok(!('clientId' in r));
      assert.ok(!('clientSecret' in r));
      assert.ok(!('tenant' in r));
      assert.equal(r.contrasena, 'x');
    }
  });
});
