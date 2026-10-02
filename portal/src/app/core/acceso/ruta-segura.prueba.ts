import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rutaInternaSegura } from './ruta-segura';

describe('rutaInternaSegura', () => {
  it('deja pasar rutas internas, con su búsqueda', () => {
    assert.equal(rutaInternaSegura('/hoy'), '/hoy');
    assert.equal(
      rutaInternaSegura('/pendientes?abrir=x'),
      '/pendientes?abrir=x'
    );
    assert.equal(
      rutaInternaSegura('/integraciones?tab=correo#a'),
      '/integraciones?tab=correo#a'
    );
  });

  it('rechaza otros orígenes y esquemas', () => {
    for (const malo of [
      'https://evil.example',
      'https://evil.example/x',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'javascript:window.__pwn=document.domain',
      'data:text/html,x',
      ' /hoy',
      '\t/hoy',
      '/ho\ny',
      '/hoy\r',
      '/\u0000hoy',
      'hoy',
      '',
      '/acceso',
      '/acceso?volver=/hoy'
    ]) {
      assert.equal(rutaInternaSegura(malo), '/hoy', JSON.stringify(malo));
    }
  });

  it('vacío y null caen en la ruta por omisión', () => {
    assert.equal(rutaInternaSegura(null), '/hoy');
    assert.equal(rutaInternaSegura(undefined), '/hoy');
    assert.equal(rutaInternaSegura(null, '/panel'), '/panel');
  });
});
