import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Fila, Sql } from '../datos/persistencia.js';
import { DIM_EMBEDDING } from '../proveedores/embeddings.js';
import { ErrorPuente } from '../nucleo/errores.js';
import {
  avisarSiFaltaBackfill,
  buscarHibrido,
  borrarPorDrive,
  guardarDocumento,
  saltarSiNoCambio,
  type DocumentoAGuardar
} from './almacen-vectorial.js';
import { resolverEmpresas, type ActorRag } from './alcance.js';

interface FragmentoFalso {
  sensibilidad: unknown;
  proyecto: unknown;
  empresa: unknown;
  cliente: unknown;
}

class SqlFalsa implements Sql {
  consultas: {
    texto: string;
    parametros: unknown[];
    enTransaccion: boolean;
  }[] = [];
  doc?: Fila;
  fragmentosGuardados: FragmentoFalso[] = [];
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
      return vigente && this.doc
        ? [
            this.estado(
              parametros[3],
              parametros[4],
              parametros[5],
              parametros[6]
            )
          ]
        : [];
    }
    if (texto.includes('FROM rag_documentos') && texto.includes('huella')) {
      if (!this.doc) {
        return [];
      }
      const [, , sensibilidad, proyecto, empresa, cliente] = parametros;
      return [this.estado(sensibilidad, proyecto, empresa, cliente)];
    }
    if (texto.includes('INSERT INTO rag_documentos')) {
      this.doc = {
        id: parametros[0],
        drive_file_id: parametros[1],
        drive_url: parametros[2],
        ruta: parametros[3],
        empresa: parametros[6],
        cliente: parametros[7],
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
        proyecto: parametros[10],
        empresa: parametros[1],
        cliente: parametros[2]
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
        this.doc['empresa'] = parametros[3];
        this.doc['cliente'] = parametros[4];
      }
      return [];
    }
    if (texto.includes('UPDATE rag_fragmentos')) {
      this.fragmentosGuardados = this.fragmentosGuardados.map(() => ({
        sensibilidad: parametros[1],
        proyecto: parametros[2],
        empresa: parametros[3],
        cliente: parametros[4]
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

  /** La fila del documento y si algun fragmento no coincide con la clase pedida. */
  private estado(
    sensibilidad: unknown,
    proyecto: unknown,
    empresa: unknown,
    cliente: unknown
  ): Fila {
    return {
      ...this.doc,
      fragmentos_desalineados: this.fragmentosGuardados.some(
        (f) =>
          f.sensibilidad !== sensibilidad ||
          f.proyecto !== proyecto ||
          f.empresa !== empresa ||
          f.cliente !== cliente
      )
    };
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

/** Como quedan los fragmentos de `documento()` cuando todo esta alineado. */
const ALINEADO: FragmentoFalso = {
  sensibilidad: 'general',
  proyecto: 'Facturacion',
  empresa: 'itech-dev',
  cliente: 'TPI Composites'
};

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

const director: ActorRag = {
  director: true,
  puedeItech: true,
  puedeCostos: true
};

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
        sensibilidad: 'general',
        documento_sensibilidad: 'general',
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
      { ...ALINEADO, sensibilidad: 'costos', proyecto: 'Portal' }
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
      { ...ALINEADO, sensibilidad: 'costos' }
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
      { ...ALINEADO, proyecto: 'Portal' }
    ]);
    // El documento ya esta bien pero el fragmento quedo con el valor por omision.
    sql.fragmentosGuardados = [
      { ...ALINEADO, sensibilidad: 'costos', proyecto: null }
    ];
    sql.consultas.length = 0;
    await saltarSiNoCambio(sql, { ...doc, proyecto: 'Portal' });
    assert.deepEqual(sql.fragmentosGuardados, [
      { ...ALINEADO, proyecto: 'Portal' }
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
      sql.fragmentosGuardados = [{ ...ALINEADO, proyecto: null }];
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
      { ...ALINEADO, proyecto: null }
    ]);
    const candado = sql.consultas.find((c) => c.texto.includes('FOR UPDATE'));
    assert.equal(candado?.enTransaccion, true);
    assert.match(
      candado?.texto ?? '',
      /d\.huella = \$2 AND d\.modelo_emb = \$3/
    );
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
    assert.match(update?.texto ?? '', /empresa IS DISTINCT FROM \$4/);
    assert.match(update?.texto ?? '', /cliente IS DISTINCT FROM \$5/);
  });

  it('con la misma huella pero otra empresa y otro cliente realinea documento y fragmentos sin reinsertar', async () => {
    const sql = new SqlFalsa();
    const doc = documento('dealer-solutions');
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    const movido: typeof doc = {
      ...doc,
      ruta: 'Empresas/Operativ AI/Otro Cliente/02_Proyecto/Juntas/a.md',
      empresa: 'operativai',
      cliente: 'Otro Cliente'
    };
    const salto = await saltarSiNoCambio(sql, movido);
    assert.equal(salto?.omitido, true);
    assert.equal(salto?.empresa, 'operativai');
    assert.equal(sql.doc?.['empresa'], 'operativai');
    assert.equal(sql.doc?.['cliente'], 'Otro Cliente');
    assert.deepEqual(sql.fragmentosGuardados, [
      {
        ...ALINEADO,
        empresa: 'operativai',
        cliente: 'Otro Cliente'
      }
    ]);
    const escrituras = sql.consultas.filter((c) => !/^\s*SELECT/.test(c.texto));
    assert.ok(escrituras.every((c) => c.enTransaccion));
    const textos = escrituras.map((c) => c.texto).join('\n');
    assert.doesNotMatch(textos, /INSERT|DELETE|embedding/);
    const candado = sql.consultas.find((c) => c.texto.includes('FOR UPDATE'));
    assert.equal(candado?.enTransaccion, true);
  });

  it('si otra ingesta cambio la fila entre la lectura y el candado, se escribe todo lo de esta, no una mezcla', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    // Esta ingesta solo ve que la ruta cambio. Antes de que tome el candado,
    // otra ingesta (de otra ruta) deja el documento como costos y en otra empresa.
    sql.alTomarElCandado = () => {
      if (sql.doc) {
        sql.doc['sensibilidad'] = 'costos';
        sql.doc['empresa'] = 'operativai';
        sql.doc['cliente'] = 'Otro';
      }
      sql.fragmentosGuardados = [
        {
          ...ALINEADO,
          sensibilidad: 'costos',
          empresa: 'operativai',
          cliente: 'Otro'
        }
      ];
    };
    const salto = await saltarSiNoCambio(sql, {
      ...doc,
      ruta: 'Empresas/Itech Dev/Cliente/02_Proyecto/Juntas/b.md'
    });
    assert.equal(salto?.omitido, true);
    assert.equal(
      sql.doc?.['ruta'],
      'Empresas/Itech Dev/Cliente/02_Proyecto/Juntas/b.md'
    );
    assert.equal(sql.doc?.['sensibilidad'], 'general');
    assert.equal(sql.doc?.['empresa'], 'itech-dev');
    assert.equal(sql.doc?.['cliente'], 'TPI Composites');
    assert.deepEqual(sql.fragmentosGuardados, [ALINEADO]);
  });

  it('un cliente que desaparece de la ruta tambien se realinea (queda sin cliente)', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.consultas.length = 0;
    const { cliente: _cliente, ...sinCliente } = doc;
    await saltarSiNoCambio(sql, sinCliente);
    assert.equal(sql.doc?.['cliente'], null);
    assert.deepEqual(sql.fragmentosGuardados, [{ ...ALINEADO, cliente: null }]);
  });

  it('un fragmento con otra empresa que su documento se corrige aunque el documento este bien', async () => {
    const sql = new SqlFalsa();
    const doc = documento();
    await guardarDocumento(sql, doc);
    sql.fragmentosGuardados = [{ ...ALINEADO, empresa: 'nexusqtech' }];
    sql.consultas.length = 0;
    const salto = await saltarSiNoCambio(sql, doc);
    assert.equal(salto?.omitido, true);
    assert.deepEqual(sql.fragmentosGuardados, [ALINEADO]);
  });

  it('la busqueda sin permiso de costos exige general en fragmento y documento en las dos consultas', async () => {
    const sql = new SqlFalsa();
    const vector = Array.from({ length: DIM_EMBEDDING }, () => 0.1);
    const clausula = resolverEmpresas(
      { pregunta: 'precios' },
      { ...director, puedeCostos: false }
    );
    await buscarHibrido(sql, 'precios', vector, { clausula }, 8);
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.equal(selects.length, 2);
    for (const consulta of selects) {
      assert.match(consulta.texto, /f\.sensibilidad = 'general'/);
      assert.match(consulta.texto, /d\.sensibilidad = 'general'/);
      assert.doesNotMatch(
        JSON.stringify(consulta.parametros),
        /costos|general/
      );
      // Antes del ORDER BY ... LIMIT, no despues.
      assert.ok(
        consulta.texto.indexOf("f.sensibilidad = 'general'") <
          consulta.texto.indexOf('ORDER BY')
      );
    }
  });

  it('con permiso de costos la busqueda no filtra por sensibilidad', async () => {
    const sql = new SqlFalsa();
    const vector = Array.from({ length: DIM_EMBEDDING }, () => 0.1);
    const clausula = resolverEmpresas({ pregunta: 'precios' }, director);
    await buscarHibrido(sql, 'precios', vector, { clausula }, 8);
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.equal(selects.length, 2);
    for (const consulta of selects) {
      assert.doesNotMatch(consulta.texto, /sensibilidad = /);
    }
  });

  it('una clausula armada a mano sin incluyeCostos queda cerrada', async () => {
    const sql = new SqlFalsa();
    const vector = Array.from({ length: DIM_EMBEDDING }, () => 0.1);
    await buscarHibrido(
      sql,
      'precios',
      vector,
      { clausula: { sql: '', excluyeItech: false } as never },
      8
    );
    for (const consulta of sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    )) {
      assert.match(consulta.texto, /f\.sensibilidad = 'general'/);
    }
  });

  it('si una consulta devolviera costos a quien no los ve, la busqueda falla en lugar de entregarlos', async () => {
    const vector = Array.from({ length: DIM_EMBEDDING }, () => 0.1);
    const fila = (extra: Fila): Fila => ({
      id: '1',
      documento_id: 'ff-1',
      orden: 0,
      seccion: 'resumen',
      texto: 'precio del modulo',
      empresa: 'dealer-solutions',
      cliente: 'Norte',
      proyecto: 'Portal',
      fecha: null,
      sensibilidad: 'general',
      documento_sensibilidad: 'general',
      titulo: 'Lista',
      drive_file_id: 'drive-1',
      drive_url: null,
      ...extra
    });
    const sinCostos = resolverEmpresas(
      { pregunta: 'precios' },
      { ...director, puedeCostos: false }
    );
    for (const extra of [
      { sensibilidad: 'costos' },
      { documento_sensibilidad: 'costos' },
      { sensibilidad: undefined },
      { documento_sensibilidad: null }
    ]) {
      const sql = new SqlFalsa();
      sql.busqueda = [fila(extra)];
      await assert.rejects(
        () => buscarHibrido(sql, 'precios', vector, { clausula: sinCostos }, 8),
        (error: unknown) => error instanceof ErrorPuente && error.estado === 500
      );
    }
    // Quien tiene costos recibe la fila.
    const sql = new SqlFalsa();
    sql.busqueda = [fila({ sensibilidad: 'costos' })];
    const hallados = await buscarHibrido(
      sql,
      'precios',
      vector,
      { clausula: resolverEmpresas({ pregunta: 'precios' }, director) },
      8
    );
    assert.equal(hallados.length, 1);
  });

  it('el aviso de backfill pendiente solo sale con fragmentos y ninguno general, y nunca lanza', async () => {
    const avisos: string[] = [];
    const con = (filas: Fila[] | Error): Sql => ({
      ejecutar: async () => {
        if (filas instanceof Error) {
          throw filas;
        }
        return filas;
      },
      transaccion: async () => {
        throw new Error('no se usa');
      }
    });
    await avisarSiFaltaBackfill(con([{ hay: false, general: false }]), (m) =>
      avisos.push(m)
    );
    await avisarSiFaltaBackfill(con([{ hay: true, general: true }]), (m) =>
      avisos.push(m)
    );
    assert.equal(avisos.length, 0);
    await avisarSiFaltaBackfill(con([{ hay: true, general: false }]), (m) =>
      avisos.push(m)
    );
    assert.equal(avisos.length, 1);
    assert.match(avisos[0] ?? '', /rag:backfill/);
    await avisarSiFaltaBackfill(con(new Error('sin tabla')), (m) =>
      avisos.push(m)
    );
    assert.equal(avisos.length, 2);
    assert.match(avisos[1] ?? '', /sin tabla/);
  });

  it('borrar por drive solo toca rag_documentos', async () => {
    const sql = new SqlFalsa();
    const n = await borrarPorDrive(sql, ['drive-1']);
    assert.equal(n, 1);
    assert.match(sql.consultas[0]?.texto ?? '', /DELETE FROM rag_documentos/);
    assert.doesNotMatch(sql.consultas[0]?.texto ?? '', /crm_/);
  });
});
