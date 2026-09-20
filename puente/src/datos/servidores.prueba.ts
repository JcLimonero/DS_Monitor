import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfiguracionPrometheus } from '../config/entorno.js';
import { AlmacenJson } from './almacen-json.js';
import type { Persistencia } from './persistencia.js';
import {
  desdeEntorno,
  fuentesCombinadas,
  sembrarDesdeEntorno,
  type ServidorVps
} from './servidores.js';

const AHORA = '2026-09-20T12:00:00.000Z';

const fuente = (
  url: string,
  extra: Partial<ConfiguracionPrometheus> = {}
): ConfiguracionPrometheus => ({
  url,
  etiquetaNombre: 'nombre',
  accountId: 'vps',
  ...extra
});

const guardado = (url: string, etiqueta = 'Nexus 1'): ServidorVps => ({
  id: 'nexus-1',
  etiqueta,
  url,
  usuario: 'dsmonitor',
  contrasena: 'x',
  actualizadoEn: AHORA
});

describe('desdeEntorno', () => {
  it('usa el nombre declarado o, si no hay, el host de la URL', () => {
    const [conNombre, sinNombre] = desdeEntorno(
      [
        fuente('http://10.0.0.1:9090/', {
          nombre: 'Nexus 1',
          usuario: 'u',
          contrasena: 'p'
        }),
        fuente('https://prom.ejemplo.mx')
      ],
      AHORA
    );
    assert.deepEqual(
      { ...conNombre },
      {
        id: 'nexus-1',
        etiqueta: 'Nexus 1',
        url: 'http://10.0.0.1:9090',
        usuario: 'u',
        contrasena: 'p',
        token: undefined,
        etiquetaNombre: undefined,
        actualizadoEn: AHORA
      }
    );
    assert.equal(sinNombre!.etiqueta, 'prom.ejemplo.mx');
    assert.equal(sinNombre!.id, 'prom-ejemplo-mx');
  });
});

describe('fuentesCombinadas', () => {
  it('no repite un servidor que ya esta en la lista con la misma URL', () => {
    const fuentes = fuentesCombinadas(
      [guardado('http://10.0.0.1:9090')],
      [fuente('http://10.0.0.1:9090/'), fuente('http://10.0.0.2:9090')]
    );
    assert.deepEqual(
      fuentes.map((f) => [f.url, f.nombre]),
      [
        ['http://10.0.0.1:9090', 'Nexus 1'],
        ['http://10.0.0.2:9090', undefined]
      ]
    );
  });
});

describe('sembrarDesdeEntorno', () => {
  const persistencia = {
    descripcion: 'memoria',
    leerColeccion: async () => new Map<string, unknown>(),
    guardar: async () => undefined,
    borrar: async () => undefined,
    cerrar: async () => undefined
  } as Persistencia;

  it('llena la lista vacia con lo del entorno y solo una vez', async () => {
    const almacen = new AlmacenJson<ServidorVps[]>(
      persistencia,
      'servidores-vps',
      []
    );
    const entorno = [fuente('http://10.0.0.1:9090', { nombre: 'Nexus 1' })];
    assert.equal(await sembrarDesdeEntorno(almacen, entorno, AHORA), 1);
    assert.equal(almacen.leer()[0]!.etiqueta, 'Nexus 1');
    assert.equal(await sembrarDesdeEntorno(almacen, entorno, AHORA), 0);
  });

  it('no toca una lista que ya tiene servidores', async () => {
    const almacen = new AlmacenJson<ServidorVps[]>(
      persistencia,
      'servidores-vps',
      [guardado('http://10.0.0.9:9090', 'Otro')]
    );
    assert.equal(
      await sembrarDesdeEntorno(
        almacen,
        [fuente('http://10.0.0.1:9090')],
        AHORA
      ),
      0
    );
    assert.equal(almacen.leer()[0]!.etiqueta, 'Otro');
  });
});
