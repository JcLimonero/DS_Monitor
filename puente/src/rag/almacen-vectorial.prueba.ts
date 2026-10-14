import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Fila, Sql } from '../datos/persistencia.js';
import { DIM_EMBEDDING } from '../proveedores/embeddings.js';
import {
  buscarHibrido,
  borrarPorDrive,
  guardarDocumento,
  saltarSiNoCambio,
  type DocumentoAGuardar
} from './almacen-vectorial.js';
import { resolverEmpresas, type ActorRag } from './alcance.js';

class SqlFalsa implements Sql {
  consultas: { texto: string; parametros: unknown[] }[] = [];
  doc?: Fila;
  busqueda: Fila[] = [];

  async ejecutar(texto: string, parametros: unknown[] = []): Promise<Fila[]> {
    this.consultas.push({ texto, parametros });
    if (texto.includes('FROM rag_documentos') && texto.includes('huella')) {
      return this.doc ? [this.doc] : [];
    }
    if (texto.includes('INSERT INTO rag_documentos')) {
      this.doc = {
        id: parametros[0],
        drive_file_id: parametros[1],
        drive_url: parametros[2],
        ruta: parametros[3],
        huella: parametros[12],
        modelo_emb: parametros[13],
        drive_modificado_en: parametros[14]
      };
      return [];
    }
    if (texto.includes('UPDATE rag_documentos') && this.doc) {
      this.doc['ruta'] = parametros[1];
      this.doc['drive_url'] = parametros[2];
      this.doc['drive_modificado_en'] = parametros[3];
      return [];
    }
    if (texto.includes('FROM rag_fragmentos')) {
      return this.busqueda;
    }
    if (
      texto.includes('DELETE FROM rag_documentos WHERE drive_file_id = ANY')
    ) {
      return (parametros[0] as string[]).map((id) => ({ id }));
    }
    return [];
  }

  transaccion<T>(f: (ejecutar: Sql['ejecutar']) => Promise<T>): Promise<T> {
    return f((texto, parametros) => this.ejecutar(texto, parametros));
  }
}

function documento(empresa = 'itech-dev'): DocumentoAGuardar {
  const embedding = Array.from({ length: DIM_EMBEDDING }, () => 0);
  return {
    id: 'ff-1',
    driveFileId: 'drive-1',
    driveUrl: 'https://drive.google.com/file/d/drive-1/view',
    ruta: 'Empresas/Itech Dev/Cliente/02_Proyecto/Juntas/a.md',
    titulo: 'Facturacion',
    fecha: '2026-10-06T18:00:00.000Z',
    empresa,
    cliente: 'TPI Composites',
    proyecto: 'Facturacion',
    tipo: 'junta',
    participantes: ['Ana'],
    frontmatter: { empresa: 'Itech Dev' },
    huella: 'abc',
    modeloEmb: 'openai/text-embedding-3-small',
    fragmentos: [
      {
        orden: 0,
        seccion: 'resumen',
        texto: 'resumen',
        tokens: 2,
        embedding
      }
    ]
  };
}

const director: ActorRag = { director: true, puedeItech: true };

describe('almacen vectorial', () => {
  it('omite un documento con la misma huella y no toca el CRM', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    const primero = await guardarDocumento(sql, doc);
    assert.equal(primero.omitido, false);
    assert.equal(primero.fragmentos, 1);
    assert.equal(primero.empresa, 'itech-dev');
    const segundo = await saltarSiNoCambio(sql, doc);
    assert.equal(segundo?.omitido, true);
    const textos = sql.consultas.map((c) => c.texto).join('\n');
    assert.doesNotMatch(textos, /crm_/);
    assert.match(textos, /rag_documentos/);
    assert.match(textos, /rag_fragmentos/);
    const insertFragmentos = sql.consultas.find((c) =>
      c.texto.includes('INSERT INTO rag_fragmentos')
    );
    assert.equal(insertFragmentos?.parametros[1], 'itech-dev');
  });

  it('la busqueda sin Itech lo excluye en las dos consultas', async () => {
    const sql = new SqlFalsa();
    sql.busqueda = [
      {
        id: '1',
        documento_id: 'ff-1',
        orden: 0,
        seccion: 'resumen',
        texto: 'hola',
        empresa: 'dealer-solutions',
        cliente: 'Norte',
        proyecto: 'Portal',
        fecha: '2026-10-06T18:00:00.000Z',
        titulo: 'Revision',
        drive_file_id: 'drive-9',
        drive_url: 'https://drive.google.com/file/d/drive-9/view'
      }
    ];
    const vector = Array.from({ length: DIM_EMBEDDING }, () => 0.1);
    const clausula = resolverEmpresas({ pregunta: 'timbrado' }, director);
    const hallados = await buscarHibrido(
      sql,
      'timbrado',
      vector,
      { clausula },
      8
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.equal(selects.length, 2);
    for (const consulta of selects) {
      assert.match(consulta.texto, /f\.empresa <> 'itech-dev'/);
      assert.doesNotMatch(JSON.stringify(consulta.parametros), /itech-dev/);
    }
    assert.equal(
      hallados[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    assert.ok((hallados[0]?.puntuacion ?? 0) > 0);
  });

  it('pedir Itech quita la exclusion', async () => {
    const sql = new SqlFalsa();
    const vector = Array.from({ length: DIM_EMBEDDING }, () => 0);
    const clausula = resolverEmpresas({ empresa: 'itech-dev' }, director);
    await buscarHibrido(sql, 'facturas', vector, { clausula }, 4);
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    for (const consulta of selects) {
      assert.doesNotMatch(consulta.texto, /<> 'itech-dev'/);
      assert.ok((consulta.parametros[0] as string[]).includes('itech-dev'));
    }
  });

  it('borrar por drive solo toca rag_documentos', async () => {
    const sql = new SqlFalsa();
    const n = await borrarPorDrive(sql, ['drive-1']);
    assert.equal(n, 1);
    assert.match(sql.consultas[0]?.texto ?? '', /DELETE FROM rag_documentos/);
    assert.doesNotMatch(sql.consultas[0]?.texto ?? '', /crm_/);
  });
});
