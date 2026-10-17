import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXCLUIR_POR_OMISION,
  configuracionRag,
  listaExcluir
} from './config.js';

const CUENTA = JSON.stringify({
  client_email: 'rag@ejemplo.test',
  private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'
});

function leerDe(variables: Record<string, string>) {
  return (nombre: string) => variables[nombre];
}

describe('RAG_DRIVE_EXCLUIR', () => {
  it('por omision excluye _OBSOLETAS e Interno/Arquitectura', () => {
    assert.deepEqual(
      [...EXCLUIR_POR_OMISION],
      ['_OBSOLETAS', 'Interno/Arquitectura']
    );
    const sin = configuracionRag(
      leerDe({ GOOGLE_DRIVE_CUENTA_SERVICIO: CUENTA })
    );
    assert.deepEqual(sin?.excluir, ['_OBSOLETAS', 'Interno/Arquitectura']);
  });

  it('en blanco, con solo espacios o con solo comas se usa la lista de omision, no una vacia', () => {
    for (const valor of ['', '   ', ',', ' , ', ',,,', ', ,\t,']) {
      assert.deepEqual(
        listaExcluir(valor),
        [...EXCLUIR_POR_OMISION],
        JSON.stringify(valor)
      );
      assert.deepEqual(
        configuracionRag(
          leerDe({
            GOOGLE_DRIVE_CUENTA_SERVICIO: CUENTA,
            RAG_DRIVE_EXCLUIR: valor
          })
        )?.excluir,
        [...EXCLUIR_POR_OMISION],
        JSON.stringify(valor)
      );
    }
    assert.deepEqual(listaExcluir(undefined), [...EXCLUIR_POR_OMISION]);
  });

  it('una lista separada por comas reemplaza a la de omision', () => {
    const cfg = configuracionRag(
      leerDe({
        GOOGLE_DRIVE_CUENTA_SERVICIO: CUENTA,
        RAG_DRIVE_EXCLUIR: ' _Archivo , Interno/Notas ,,05_Privado '
      })
    );
    assert.deepEqual(cfg?.excluir, ['_Archivo', 'Interno/Notas', '05_Privado']);
  });

  it('fijarla reemplaza la de omision y un guion no excluye nada', () => {
    assert.deepEqual(listaExcluir('Interno/Notas'), ['Interno/Notas']);
    assert.equal(listaExcluir('Interno/Notas').includes('_OBSOLETAS'), false);
    assert.deepEqual(listaExcluir('-'), ['-']);
    assert.deepEqual(listaExcluir('_OBSOLETAS,Interno/Arquitectura,Otra'), [
      '_OBSOLETAS',
      'Interno/Arquitectura',
      'Otra'
    ]);
  });

  it('la lista de omision no se comparte entre llamadas', () => {
    const a = listaExcluir(undefined);
    a.push('otra');
    assert.deepEqual(listaExcluir(undefined), [...EXCLUIR_POR_OMISION]);
  });
});
