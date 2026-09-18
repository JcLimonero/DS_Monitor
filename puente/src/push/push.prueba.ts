import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { describe, it } from 'node:test';
import { clavesCoherentes, encabezadoVapid, generarClaves } from './vapid.js';

describe('vapid', () => {
  it('genera un par coherente y firma un JWT ES256 verificable', () => {
    const claves = generarClaves();
    assert.equal(Buffer.from(claves.publica, 'base64url').length, 65);
    assert.equal(clavesCoherentes(claves), true);
    const encabezado = encabezadoVapid(
      claves,
      'https://fcm.googleapis.com/fcm/send/abc',
      'carlos@ejemplo.com'
    );
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(encabezado);
    assert.ok(m);
    const [cab, cuerpo, firma] = (m?.[1] as string).split('.');
    const carga = JSON.parse(
      Buffer.from(cuerpo as string, 'base64url').toString()
    );
    assert.equal(carga.aud, 'https://fcm.googleapis.com');
    assert.equal(carga.sub, 'mailto:carlos@ejemplo.com');
    const publica = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: Buffer.from(claves.publica, 'base64url')
          .subarray(1, 33)
          .toString('base64url'),
        y: Buffer.from(claves.publica, 'base64url')
          .subarray(33)
          .toString('base64url')
      },
      format: 'jwk'
    });
    assert.equal(
      verify(
        'sha256',
        Buffer.from(`${cab}.${cuerpo}`),
        { key: publica, dsaEncoding: 'ieee-p1363' },
        Buffer.from(firma as string, 'base64url')
      ),
      true
    );
    assert.equal(m?.[2], claves.publica);
  });

  it('detecta un par que no corresponde', () => {
    const a = generarClaves();
    const b = generarClaves();
    assert.equal(
      clavesCoherentes({ publica: a.publica, privadaPem: b.privadaPem }),
      false
    );
  });
});
