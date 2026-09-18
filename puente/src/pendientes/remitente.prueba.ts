import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { clasificarRemitente } from './remitente.js';

function correo(de: string, tags: string[] = ['correo']): TaskItem {
  return {
    id: 'x',
    title: 't',
    description: `De: ${de}\nPara: yo`,
    status: 'pendiente',
    priority: 'media',
    accountId: 'correo-nexus',
    origin: 'correo',
    tags,
    updatedAt: ''
  };
}

describe('remitente de un pendiente de correo', () => {
  const equipo = [{ id: 'e', name: 'Efrén', email: 'efren@ejemplo.com' }];
  it('propio o del equipo → equipo', () => {
    assert.equal(
      clasificarRemitente(correo('Ana <ana@itechdev.com.mx>'), equipo),
      'equipo'
    );
    assert.equal(
      clasificarRemitente(correo('Efrén <efren@ejemplo.com>'), equipo),
      'equipo'
    );
  });
  it('automatico, regla o dominio de empresa → empresa', () => {
    assert.equal(
      clasificarRemitente(correo('Paddle <help@paddle.com>'), equipo),
      'empresa'
    );
    assert.equal(
      clasificarRemitente(correo('Juan <juan@acme.com>'), equipo),
      'empresa'
    );
    assert.equal(
      clasificarRemitente(
        correo('x <x@gmail.com>', ['correo', 'licencia']),
        equipo
      ),
      'empresa'
    );
  });
  it('correo gratuito o sin remitente → por identificar', () => {
    assert.equal(
      clasificarRemitente(correo('Alguien <alguien@gmail.com>'), equipo),
      'por_identificar'
    );
    assert.equal(
      clasificarRemitente({ ...correo('x'), description: '' }, equipo),
      'por_identificar'
    );
  });
  it('lo que no es de correo no se toca', () => {
    assert.equal(
      clasificarRemitente({ ...correo('a@b.com'), origin: 'local' }, equipo),
      undefined
    );
  });
});
