import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AlmacenJson } from '../datos/almacen-json.js';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import { Acceso, type Sesion } from './acceso.js';

const CONFIG = {
  serviceId: 's',
  templateId: 't',
  publicKey: 'p',
  privateKey: 'k',
  correos: ['yo@ejemplo.com']
};

async function nuevo() {
  const dir = await mkdtemp(join(tmpdir(), 'acceso-'));
  const enviados: { correo: string; codigo: string }[] = [];
  const acceso = new Acceso(
    new AlmacenJson<Sesion[]>(
      new PersistenciaArchivos({ datos: dir }),
      'sesiones',
      []
    ),
    async (_config, correo, codigo) => {
      enviados.push({ correo, codigo });
    }
  );
  return { acceso, enviados };
}

describe('acceso con código por correo', () => {
  it('manda un código de seis dígitos solo a los correos autorizados', async () => {
    const { acceso, enviados } = await nuevo();
    await acceso.pedirCodigo(CONFIG, 'YO@ejemplo.com ');
    await acceso.pedirCodigo(CONFIG, 'otro@ejemplo.com');
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0]?.correo, 'yo@ejemplo.com');
    assert.match(enviados[0]?.codigo ?? '', /^\d{6}$/);
  });

  it('con el código entrega una sesión y el código se gasta', async () => {
    const { acceso, enviados } = await nuevo();
    await acceso.pedirCodigo(CONFIG, 'yo@ejemplo.com');
    const codigo = enviados[0]?.codigo ?? '';
    const sesion = await acceso.entrar(
      'yo@ejemplo.com',
      `${codigo.slice(0, 3)} ${codigo.slice(3)}`
    );
    assert.equal(sesion.correo, 'yo@ejemplo.com');
    assert.ok(acceso.sesionDe(sesion.token));
    await assert.rejects(
      acceso.entrar('yo@ejemplo.com', codigo),
      /no es válido/
    );
  });

  it('un código equivocado no entra y cinco intentos lo anulan', async () => {
    const { acceso, enviados } = await nuevo();
    await acceso.pedirCodigo(CONFIG, 'yo@ejemplo.com');
    for (let i = 0; i < 5; i++) {
      await assert.rejects(
        acceso.entrar('yo@ejemplo.com', '000000'),
        /no coincide/
      );
    }
    await assert.rejects(
      acceso.entrar('yo@ejemplo.com', enviados[0]?.codigo ?? ''),
      /no coincide|no es válido/
    );
  });

  it('salir invalida el token', async () => {
    const { acceso, enviados } = await nuevo();
    await acceso.pedirCodigo(CONFIG, 'yo@ejemplo.com');
    const sesion = await acceso.entrar(
      'yo@ejemplo.com',
      enviados[0]?.codigo ?? ''
    );
    await acceso.salir(sesion.token);
    assert.equal(acceso.sesionDe(sesion.token), undefined);
    assert.equal(acceso.sesionDe('cualquier-cosa'), undefined);
  });
});
