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
  consultas: {
    texto: string;
    parametros: unknown[];
    enTransaccion: boolean;
  }[] = [];
  doc?: Fila;
  fragmentosGuardados: { sensibilidad: unknown; proyecto: unknown }[] = [];
  busqueda: Fila[] = [];
  /** Simula a otra ingesta que reemplaza el documento antes de que se tome el candado. */
  alTomarElCandado?: () => void;
  private dentro = false;

  async ejecutar(texto: string, parametros: unknown[] = []): Promise<Fila[]> {
    this.consultas.push({ texto, parametros, enTransaccion: this.dentro });
    if (texto.includes('FOR UPDATE')) {
      this.alTomarElCandado?.();
      const vigente =
        this.doc?.['id'] === parametros[0] &&
        this.doc?.['huella'] === parametros[1] &&
        this.doc?.['modelo_emb'] === parametros[2];
      return vigente ? [{ id: parametros[0] }] : [];
    }
    if (texto.includes('FROM rag_documentos') && texto.includes('huella')) {
      if (!this.doc) {
        return [];
      }
      const sensibilidad = parametros[2];
      const proyecto = parametros[3];
      return [
        {
          ...this.doc,
          fragmentos_desalineados: this.fragmentosGuardados.some(
            (f) => f.sensibilidad !== sensibilidad || f.proyecto !== proyecto
          )
        }
      ];
    }
    if (texto.includes('INSERT INTO rag_documentos')) {
      this.doc = {
        id: parametros[0],
        drive_file_id: parametros[1],
        drive_url: parametros[2],
        ruta: parametros[3],
        proyecto: parametros[8],
        huella: parametros[12],
        modelo_emb: parametros[13],
        drive_modificado_en: parametros[14],
        sensibilidad: parametros[15]
      };
      return [];
    }
    if (texto.includes('INSERT INTO rag_fragmentos')) {
      const cuantos = (parametros[4] as unknown[]).length;
      this.fragmentosGuardados = Array.from({ length: cuantos }, () => ({
        sensibilidad: parametros[9],
        proyecto: parametros[10]
      }));
      return [];
    }
    if (texto.includes('UPDATE rag_documentos') && this.doc) {
      if (texto.includes('SET ruta')) {
        this.doc['ruta'] = parametros[1];
        this.doc['drive_url'] = parametros[2];
        this.doc['drive_modificado_en'] = parametros[3];
      } else {
        this.doc['sensibilidad'] = parametros[1];
        this.doc['proyecto'] = parametros[2];
      }
      return [];
    }
    if (texto.includes('UPDATE rag_fragmentos')) {
      this.fragmentosGuardados = this.fragmentosGuardados.map(() => ({
        sensibilidad: parametros[1],
        proyecto: parametros[2]
      }));
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

  async transaccion<T>(
    f: (ejecutar: Sql['ejecutar']) => Promise<T>
  ): Promise<T> {
    this.dentro = true;
    try {
      return await f((texto, parametros) => this.ejecutar(texto, parametros));
    } finally {
      this.dentro = false;
    }
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
    sensibilidad: 'general',
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

  it('guarda la sensibilidad en el documento y el proyecto y la sensibilidad en cada fragmento', async () => {
    const sql = new SqlFalsa();
    await guardarDocumento(sql, {
      ...documento(),
      sensibilidad: 'costos',
      proyecto: 'Portal'
    });
    assert.equal(sql.doc?.['sensibilidad'], 'costos');
    const insertFragmentos = sql.consultas.find((c) =>
      c.texto.includes('INSERT INTO rag_fragmentos')
    );
    assert.match(insertFragmentos?.texto ?? '', /sensibilidad, proyecto/);
    assert.equal(insertFragmentos?.parametros[9], 'costos');
    assert.equal(insertFragmentos?.parametros[10], 'Portal');
    assert.deepEqual(sql.fragmentosGuardados, [
      { sensibilidad: 'costos', proyecto: 'Portal' }
    ]);
  });

  it('con la misma huella y la misma clasificacion no escribe nada', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    const salto = await saltarSiNoCambio(sql, doc);
    assert.equal(salto?.omitido, true);
    assert.equal(sql.consultas.length, 1);
    assert.match(sql.consultas[0]?.texto ?? '', /^\s*SELECT/);
  });

  it('con la misma huella pero otra sensibilidad reclasifica documento y fragmentos sin reinsertar', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    const movido: typeof doc = {
      ...doc,
      ruta: 'Empresas/Itech Dev/Cliente/04_Costos/a.md',
      sensibilidad: 'costos'
    };
    const salto = await saltarSiNoCambio(sql, movido);
    assert.equal(salto?.omitido, true);
    assert.equal(sql.doc?.['sensibilidad'], 'costos');
    assert.equal(sql.doc?.['ruta'], movido.ruta);
    assert.deepEqual(sql.fragmentosGuardados, [
      { sensibilidad: 'costos', proyecto: 'Facturacion' }
    ]);
    const escrituras = sql.consultas.filter((c) => !/^\s*SELECT/.test(c.texto));
    assert.equal(escrituras.length, 3);
    assert.ok(escrituras.every((c) => c.enTransaccion));
    const textos = escrituras.map((c) => c.texto).join('\n');
    assert.doesNotMatch(textos, /INSERT|DELETE|embedding/);
    assert.match(textos, /UPDATE rag_fragmentos/);
  });

  it('reclasifica cuando el proyecto cambia o un fragmento no coincide con su documento', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    await saltarSiNoCambio(sql, { ...doc, proyecto: 'Portal' });
    assert.equal(sql.doc?.['proyecto'], 'Portal');
    assert.deepEqual(sql.fragmentosGuardados, [
      { sensibilidad: 'general', proyecto: 'Portal' }
    ]);
    // El documento ya esta bien pero el fragmento quedo con el valor por omision.
    sql.fragmentosGuardados = [{ sensibilidad: 'costos', proyecto: null }];
    sql.consultas.length = 0;
    await saltarSiNoCambio(sql, { ...doc, proyecto: 'Portal' });
    assert.deepEqual(sql.fragmentosGuardados, [
      { sensibilidad: 'general', proyecto: 'Portal' }
    ]);
  });

  it('si otra ingesta reemplazo el documento antes del candado no escribe nada', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    sql.alTomarElCandado = () => {
      if (sql.doc) {
        sql.doc['huella'] = 'otra-huella';
        sql.doc['sensibilidad'] = 'general';
      }
      sql.fragmentosGuardados = [{ sensibilidad: 'general', proyecto: null }];
    };
    const salto = await saltarSiNoCambio(sql, {
      ...doc,
      ruta: 'Empresas/Itech Dev/Cliente/04_Costos/a.md',
      sensibilidad: 'costos'
    });
    assert.equal(salto, undefined);
    const escrituras = sql.consultas.filter((c) => !/^\s*SELECT/.test(c.texto));
    assert.deepEqual(escrituras, []);
    assert.equal(sql.doc?.['sensibilidad'], 'general');
    assert.deepEqual(sql.fragmentosGuardados, [
      { sensibilidad: 'general', proyecto: null }
    ]);
    const candado = sql.consultas.find((c) => c.texto.includes('FOR UPDATE'));
    assert.equal(candado?.enTransaccion, true);
    assert.match(candado?.texto ?? '', /huella = \$2 AND modelo_emb = \$3/);
  });

  it('el UPDATE de fragmentos solo reescribe los que difieren', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    await saltarSiNoCambio(sql, { ...doc, sensibilidad: 'costos' });
    const update = sql.consultas.find((c) =>
      c.texto.includes('UPDATE rag_fragmentos')
    );
    assert.match(update?.texto ?? '', /WHERE documento_id = \$1/);
    assert.match(update?.texto ?? '', /sensibilidad IS DISTINCT FROM \$2/);
    assert.match(update?.texto ?? '', /proyecto IS DISTINCT FROM \$3/);
  });

  it('borrar por drive solo toca rag_documentos', async () => {
    const sql = new SqlFalsa();
    const n = await borrarPorDrive(sql, ['drive-1']);
    assert.equal(n, 1);
    assert.match(sql.consultas[0]?.texto ?? '', /DELETE FROM rag_documentos/);
    assert.doesNotMatch(sql.consultas[0]?.texto ?? '', /crm_/);
  });
});
