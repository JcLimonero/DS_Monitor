import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorPuente } from '../nucleo/errores.js';
import { EMPRESA_ITECH } from './empresas-rag.js';
import {
  resolverEmpresas,
  sqlEmpresas,
  sqlSensibilidad,
  type ActorRag
} from './alcance.js';
import { fusionarRrf } from './hibrida.js';
import { clienteMencionado } from './menciones.js';

const director: ActorRag = {
  director: true,
  puedeItech: true,
  puedeCostos: true
};

describe('alcance del RAG: Itech no se mezcla', () => {
  it('nombrar a Itech en la lista es pedirla; sin eso el SQL la quita', () => {
    const explicita = resolverEmpresas(
      { empresas: ['dealer-solutions', 'itech-dev'] },
      director
    );
    assert.equal(explicita.excluyeItech, false);
    assert.deepEqual(explicita.empresas, ['dealer-solutions', 'itech-dev']);
    const mezcla = resolverEmpresas(
      { empresas: ['dealer-solutions', 'nexusqtech'] },
      director
    );
    assert.equal(mezcla.excluyeItech, true);
    const sql = sqlEmpresas(mezcla, 1, 'f.empresa');
    assert.match(sql.sql, /f\.empresa <> 'itech-dev'/);
    assert.deepEqual(sql.parametros, [['dealer-solutions', 'nexusqtech']]);
  });

  it('el director sin filtro excluye Itech y no arma lista', () => {
    const clausula = resolverEmpresas({ pregunta: 'timbrado' }, director);
    assert.equal(clausula.excluyeItech, true);
    assert.equal(clausula.empresas, undefined);
    assert.match(sqlEmpresas(clausula, 1).sql, /empresa <> 'itech-dev'/);
  });

  it('pedir Itech sin permiso responde 403', () => {
    const actor: ActorRag = {
      director: false,
      tope: ['dealer-solutions'],
      puedeItech: false,
      puedeCostos: false
    };
    assert.throws(
      () => resolverEmpresas({ empresa: 'itech-dev' }, actor),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 403
    );
    assert.throws(
      () => resolverEmpresas({ incluirItech: true }, actor),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 403
    );
  });

  it('el director que pide Itech solo ve Itech', () => {
    const clausula = resolverEmpresas({ empresa: 'Itech Dev' }, director);
    assert.equal(clausula.excluyeItech, false);
    assert.deepEqual(clausula.empresas, [EMPRESA_ITECH]);
    const sql = sqlEmpresas(clausula, 2, 'f.empresa');
    assert.doesNotMatch(sql.sql, /<>/);
    assert.match(sql.sql, /\$2/);
  });

  it('un token que solo es Itech consulta Itech aunque no lo escriba', () => {
    const clausula = resolverEmpresas(
      {},
      {
        director: false,
        tope: ['itech-dev'],
        puedeItech: true,
        puedeCostos: false
      }
    );
    assert.equal(clausula.excluyeItech, false);
    assert.deepEqual(clausula.empresas, ['itech-dev']);
  });

  it('un token con varias empresas deja fuera a Itech si no la pide', () => {
    const clausula = resolverEmpresas(
      {},
      {
        director: false,
        tope: ['dealer-solutions', 'itech-dev'],
        puedeItech: true,
        puedeCostos: false
      }
    );
    assert.equal(clausula.excluyeItech, true);
    assert.deepEqual(clausula.empresas, ['dealer-solutions']);
  });

  it('alias de la propuesta caen en los ids del catalogo', () => {
    const clausula = resolverEmpresas({ empresa: 'nexus-q-tech' }, director);
    assert.deepEqual(clausula.empresas, ['nexusqtech']);
    const operativ = resolverEmpresas({ empresa: 'operativ-ai' }, director);
    assert.deepEqual(operativ.empresas, ['operativai']);
  });
});

describe('alcance del RAG: costos', () => {
  const sinCostos: ActorRag = { ...director, puedeCostos: false };

  it('la clausula copia el permiso del actor y nada mas', () => {
    assert.equal(resolverEmpresas({}, director).incluyeCostos, true);
    assert.equal(resolverEmpresas({}, sinCostos).incluyeCostos, false);
    const acotado: ActorRag = {
      director: false,
      tope: ['dealer-solutions'],
      puedeItech: false,
      puedeCostos: true
    };
    for (const pedido of [
      {},
      { empresa: 'dealer-solutions' },
      { empresas: ['dealer-solutions'] }
    ]) {
      assert.equal(resolverEmpresas(pedido, acotado).incluyeCostos, true);
      assert.equal(
        resolverEmpresas(pedido, { ...acotado, puedeCostos: false })
          .incluyeCostos,
        false
      );
    }
    assert.equal(
      resolverEmpresas({ empresa: 'itech-dev' }, director).incluyeCostos,
      true
    );
    assert.equal(
      resolverEmpresas({ empresa: 'itech-dev' }, sinCostos).incluyeCostos,
      false
    );
  });

  it('la peticion no puede pedir costos: ningun campo extra cambia la clausula', () => {
    const extra = {
      pregunta: 'precios',
      incluirCostos: true,
      costos: true,
      puedeCostos: true,
      sensibilidad: 'costos'
    } as unknown as Parameters<typeof resolverEmpresas>[0];
    assert.equal(resolverEmpresas(extra, sinCostos).incluyeCostos, false);
  });

  it('sin permiso el SQL es una lista blanca en fragmento y documento, sin parametros', () => {
    for (const incluyeCostos of [false, undefined, null, 'true', 1]) {
      const sql = sqlSensibilidad({
        incluyeCostos: incluyeCostos as unknown as boolean
      });
      assert.equal(
        sql,
        "AND f.sensibilidad = 'general' AND d.sensibilidad = 'general'"
      );
      assert.doesNotMatch(sql, /\$\d/);
    }
  });

  it('con permiso no agrega condicion', () => {
    assert.equal(sqlSensibilidad({ incluyeCostos: true }), '');
  });

  it('usa los alias que se le pasan', () => {
    assert.equal(
      sqlSensibilidad({ incluyeCostos: false }, 'frag', 'doc'),
      "AND frag.sensibilidad = 'general' AND doc.sensibilidad = 'general'"
    );
  });
});

describe('fusion RRF y cliente en la pregunta', () => {
  it('quien sale en las dos listas queda arriba', () => {
    const fusion = fusionarRrf(
      [
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }]
      ],
      60
    );
    assert.equal(fusion[0]?.id, 'b');
    assert.ok((fusion[0]?.puntuacion ?? 0) > (fusion[1]?.puntuacion ?? 0));
  });

  it('un solo cliente mencionado se vuelve filtro', () => {
    assert.equal(
      clienteMencionado('que dijo TPI Composites del timbrado', [
        'TPI Composites',
        'Taller Norte'
      ]),
      'TPI Composites'
    );
    assert.equal(
      clienteMencionado('TPI Composites y Taller Norte', [
        'TPI Composites',
        'Taller Norte'
      ]),
      undefined
    );
  });
});
