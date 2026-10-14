import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorPuente } from '../nucleo/errores.js';
import { EMPRESA_ITECH } from './empresas-rag.js';
import { resolverEmpresas, sqlEmpresas, type ActorRag } from './alcance.js';
import { fusionarRrf } from './hibrida.js';
import { clienteMencionado } from './menciones.js';

const director: ActorRag = { director: true, puedeItech: true };

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
      puedeItech: false
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
      { director: false, tope: ['itech-dev'], puedeItech: true }
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
        puedeItech: true
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
