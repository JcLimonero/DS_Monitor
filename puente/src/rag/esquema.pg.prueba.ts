import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import {
  PersistenciaArchivos,
  type Fila,
  type Sql
} from '../datos/persistencia.js';
import { abrirDatos, cargarDatos, construirRutas } from '../servidor/rutas.js';
import { establecerGanchosRag } from '../servidor/rutas-rag.js';
import { resolverEmpresas, type ActorRag } from './alcance.js';
import {
  buscarHibrido,
  guardarDocumento,
  saltarSiNoCambio,
  type DocumentoAGuardar
} from './almacen-vectorial.js';
import { asegurarEsquemaRag } from './esquema.js';
import {
  abrirEsquemaAleatorio,
  exigirBaseLocal,
  urlDePrueba,
  vectorDeterminista,
  type EsquemaPrueba
} from './pg-prueba.js';

/**
 * Pruebas contra un Postgres 16 con pgvector de verdad.
 *
 * Se omiten solas si TEST_DATABASE_URL no esta definida (el `npm test` normal
 * no necesita base). Con ella, cada bloque trabaja en un esquema de nombre
 * aleatorio que se elimina al terminar; ver pg-prueba.ts.
 */
const url = urlDePrueba();
const OMITIR = url ? false : 'sin TEST_DATABASE_URL: no hay Postgres de prueba';

const director: ActorRag = {
  director: true,
  puedeItech: true,
  puedeCostos: true
};

async function conEsquema(
  trabajo: (esquema: EsquemaPrueba) => Promise<void>
): Promise<void> {
  const esquema = await abrirEsquemaAleatorio(url as string);
  try {
    await trabajo(esquema);
  } finally {
    await esquema.cerrar();
  }
}

/** Columnas, constraints e indices de las tablas del RAG, sin el nombre del esquema. */
async function descripcion(esquema: EsquemaPrueba): Promise<string[]> {
  const columnas = await esquema.filas(
    `SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
            || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
            || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') AS linea
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE c.relnamespace = $1::regnamespace
        AND c.relkind = 'r'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum`,
    [esquema.nombre]
  );
  const restricciones = await esquema.filas(
    `SELECT c.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid) AS linea
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid
      WHERE k.connamespace = $1::regnamespace
      ORDER BY c.relname, k.conname`,
    [esquema.nombre]
  );
  const indices = await esquema.filas(
    `SELECT replace(indexdef, $1 || '.', '') AS linea
       FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`,
    [esquema.nombre]
  );
  return [...columnas, ...restricciones, ...indices].map((f) =>
    String(f['linea'])
  );
}

/** pg_relation_filenode cambia si una tabla o un indice se reescribe o reconstruye. */
async function archivosFisicos(
  esquema: EsquemaPrueba
): Promise<Record<string, string>> {
  const filas = await esquema.filas(
    `SELECT relname, pg_relation_filenode(oid)::text AS archivo
       FROM pg_class
      WHERE relnamespace = $1::regnamespace AND relkind IN ('r', 'i')`,
    [esquema.nombre]
  );
  return Object.fromEntries(
    filas.map((f) => [String(f['relname']), String(f['archivo'])])
  );
}

/**
 * Espera a que una escritura sobre el documento quede detenida por un candado de fila.
 * pg_stat_activity recorta el texto de la consulta (1024 bytes): la lectura con candado
 * de saltarSiNoCambio ya es mas larga, asi que tambien se reconoce por su inicio.
 */
async function esperarBloqueo(esquema: EsquemaPrueba): Promise<void> {
  for (let intento = 0; intento < 100; intento++) {
    const filas = await esquema.filas(
      `SELECT count(*)::int AS n
         FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND (
            query ILIKE '%FOR UPDATE%'
            OR query ILIKE 'UPDATE rag_%'
            OR query ILIKE 'SELECT d.id, d.huella%'
          )
          AND pid <> pg_backend_pid()`
    );
    if (Number(filas[0]?.['n']) > 0) {
      return;
    }
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
  throw new Error('La consulta nunca quedo esperando el candado.');
}

function literal(vector: readonly number[]): string {
  return `[${vector.join(',')}]`;
}

const DDL_VIEJO_INSERTS = {
  documento: `INSERT INTO rag_documentos
      (id, drive_file_id, ruta, titulo, empresa, cliente, proyecto, huella, modelo_emb)
    VALUES ('viejo-1', 'drive-viejo-1', 'Empresas/Dealer Solutions/Cliente/04_Costos/lista.md',
            'Lista de precios', 'dealer-solutions', 'Cliente', 'Portal', 'h1', 'modelo')`,
  fragmento: `INSERT INTO rag_fragmentos
      (documento_id, orden, seccion, empresa, cliente, texto, tokens, embedding)
    VALUES ('viejo-1', 0, 'resumen', 'dealer-solutions', 'Cliente',
            'El precio del modulo es de mil pesos.', 9, $1::halfvec)`
};

describe('esquema del RAG contra Postgres real', { skip: OMITIR }, () => {
  it('se niega a correr contra una base que no es local', () => {
    for (const remota of [
      'postgres://u:p@db.ejemplo.test:5432/x',
      'postgres://u:p@10.0.0.5/x',
      'postgres://u:p@localhost.ejemplo.test/x',
      'postgres://u:p@localhost/x?host=db.ejemplo.test',
      'postgres://u:p@127.0.0.1/x?hostaddr=10.0.0.5',
      'mysql://u:p@localhost/x',
      'no es una url'
    ]) {
      assert.throws(() => exigirBaseLocal(remota), /TEST_DATABASE_URL/, remota);
    }
    for (const local of [
      'postgres://u:p@localhost:5432/x',
      'postgresql://u:p@127.0.0.1:54329/x',
      'postgres://u:p@[::1]:5432/x'
    ]) {
      assert.doesNotThrow(() => exigirBaseLocal(local), local);
    }
  });

  it('asegurarEsquemaRag corre dos veces seguidas sin error y deja columnas, CHECK e indice', () =>
    conEsquema(async (e) => {
      await asegurarEsquemaRag(e.sql);
      const primera = await descripcion(e);
      await asegurarEsquemaRag(e.sql);
      assert.deepEqual(await descripcion(e), primera);
      const lineas = primera.join('\n');
      assert.match(
        lineas,
        /rag_documentos\.sensibilidad text NOT NULL DEFAULT 'costos'::text/
      );
      assert.match(
        lineas,
        /rag_fragmentos\.sensibilidad text NOT NULL DEFAULT 'costos'::text/
      );
      assert.match(lineas, /rag_fragmentos\.proyecto text\n/);
      assert.match(
        lineas,
        /rag_fragmentos rag_fragmentos_sensibilidad_valida CHECK \(\(sensibilidad = ANY \(ARRAY\['general'::text, 'costos'::text\]\)\)\)/
      );
      assert.match(
        lineas,
        /CREATE INDEX rag_fragmentos_empresa_sensibilidad ON rag_fragmentos USING btree \(empresa, sensibilidad\)/
      );
      assert.match(lineas, /USING hnsw \(embedding halfvec_cosine_ops\)/);
      // El candado de espera era local a la sentencia: no se queda en la conexion.
      const espera = await e.filas('SHOW lock_timeout');
      assert.equal(espera[0]?.['lock_timeout'], '0');
    }));

  it('un INSERT que no menciona la sensibilidad queda como costos', () =>
    conEsquema(async (e) => {
      await asegurarEsquemaRag(e.sql);
      await e.sql.ejecutar(DDL_VIEJO_INSERTS.documento);
      await e.sql.ejecutar(DDL_VIEJO_INSERTS.fragmento, [
        literal(vectorDeterminista('a'))
      ]);
      const doc = await e.filas('SELECT sensibilidad FROM rag_documentos');
      const frag = await e.filas(
        'SELECT sensibilidad, proyecto FROM rag_fragmentos'
      );
      assert.equal(doc[0]?.['sensibilidad'], 'costos');
      assert.equal(frag[0]?.['sensibilidad'], 'costos');
      assert.equal(frag[0]?.['proyecto'], null);
    }));

  it('el CHECK rechaza un valor invalido, y un nulo, en las dos tablas', () =>
    conEsquema(async (e) => {
      await asegurarEsquemaRag(e.sql);
      await e.sql.ejecutar(DDL_VIEJO_INSERTS.documento);
      await e.sql.ejecutar(DDL_VIEJO_INSERTS.fragmento, [
        literal(vectorDeterminista('a'))
      ]);
      const falla = async (texto: string, codigo: string) =>
        assert.rejects(
          () => e.sql.ejecutar(texto),
          (error: unknown) => (error as { code?: string }).code === codigo,
          texto
        );
      await falla(
        `UPDATE rag_documentos SET sensibilidad = 'publico'`,
        '23514'
      );
      await falla(`UPDATE rag_fragmentos SET sensibilidad = 'Costos'`, '23514');
      await falla(`UPDATE rag_fragmentos SET sensibilidad = ''`, '23514');
      await falla(`UPDATE rag_documentos SET sensibilidad = NULL`, '23502');
      await falla(`UPDATE rag_fragmentos SET sensibilidad = NULL`, '23502');
      await falla(
        DDL_VIEJO_INSERTS.documento
          .replace(/'viejo-1'/g, "'otro'")
          .replace("'drive-viejo-1'", "'drive-otro'")
          .replace('proyecto, huella', 'proyecto, sensibilidad, huella')
          .replace("'Portal', 'h1'", "'Portal', 'secreto', 'h1'"),
        '23514'
      );
      await e.sql.ejecutar(
        `UPDATE rag_fragmentos SET sensibilidad = 'general'`
      );
    }));

  it('desde el esquema de 001, la fila previa queda como costos y nada se reescribe', () =>
    conEsquema(async (e) => {
      await e.pool.query(
        await readFile('migraciones/001-rag-vectorial.sql', 'utf8')
      );
      await e.sql.ejecutar(DDL_VIEJO_INSERTS.documento);
      await e.sql.ejecutar(DDL_VIEJO_INSERTS.fragmento, [
        literal(vectorDeterminista('a'))
      ]);
      const antes = await archivosFisicos(e);
      assert.ok(antes['rag_fragmentos_embedding_hnsw']);

      await asegurarEsquemaRag(e.sql);

      const doc = await e.filas(
        'SELECT sensibilidad, proyecto, titulo FROM rag_documentos'
      );
      const frag = await e.filas(
        'SELECT sensibilidad, proyecto, texto FROM rag_fragmentos'
      );
      assert.equal(doc[0]?.['sensibilidad'], 'costos');
      assert.equal(doc[0]?.['proyecto'], 'Portal');
      assert.equal(doc[0]?.['titulo'], 'Lista de precios');
      assert.equal(frag[0]?.['sensibilidad'], 'costos');
      assert.equal(frag[0]?.['proyecto'], null);
      assert.match(String(frag[0]?.['texto']), /precio del modulo/);

      const despues = await archivosFisicos(e);
      for (const objeto of [
        'rag_documentos',
        'rag_fragmentos',
        'rag_fragmentos_embedding_hnsw',
        'rag_fragmentos_tsv',
        'rag_fragmentos_empresa_cliente'
      ]) {
        assert.equal(
          despues[objeto],
          antes[objeto],
          `${objeto} se reescribio o se reconstruyo`
        );
      }
      assert.ok(despues['rag_fragmentos_empresa_sensibilidad']);

      // La busqueda por vector sigue encontrando la fila sobre el indice HNSW.
      const hallados = await e.filas(
        `SELECT id FROM rag_fragmentos ORDER BY embedding <=> $1::halfvec LIMIT 1`,
        [literal(vectorDeterminista('a'))]
      );
      assert.equal(hallados.length, 1);
    }));

  it('el espejo 002 deja el mismo esquema que el arranque', async () => {
    const viejo = await readFile('migraciones/001-rag-vectorial.sql', 'utf8');
    const espejo = await readFile(
      'migraciones/002-rag-sensibilidad.sql',
      'utf8'
    );
    await conEsquema(async (conArchivos) => {
      await conEsquema(async (conArranque) => {
        await conArchivos.pool.query(viejo);
        await conArchivos.pool.query(espejo);
        await conArchivos.pool.query(espejo);
        await asegurarEsquemaRag(conArranque.sql);
        assert.deepEqual(
          await descripcion(conArchivos),
          await descripcion(conArranque)
        );
      });
    });
  });

  it('si no consigue el candado a tiempo falla sin dejar nada a medias y despues se reintenta', () =>
    conEsquema(async (e) => {
      await e.pool.query(
        await readFile('migraciones/001-rag-vectorial.sql', 'utf8')
      );
      const lector = await e.pool.connect();
      try {
        // Una consulta abierta que no termina: ACCESS SHARE contra el ACCESS EXCLUSIVE del ALTER.
        await lector.query('BEGIN');
        await lector.query('SELECT count(*) FROM rag_documentos');
        const inicio = Date.now();
        await assert.rejects(
          () => asegurarEsquemaRag(e.sql, { lockTimeout: '300ms' }),
          (error: unknown) => (error as { code?: string }).code === '55P03'
        );
        assert.ok(
          Date.now() - inicio < 5000,
          'espero demasiado por el candado'
        );
        const sinColumnas = await e.filas(
          `SELECT count(*)::int AS n FROM pg_attribute
            WHERE attrelid = 'rag_documentos'::regclass AND attname = 'sensibilidad'`
        );
        assert.equal(sinColumnas[0]?.['n'], 0);
      } finally {
        await lector.query('ROLLBACK');
        lector.release();
      }
      await asegurarEsquemaRag(e.sql, { lockTimeout: '300ms' });
      const conColumnas = await e.filas(
        `SELECT count(*)::int AS n FROM pg_attribute
          WHERE attrelid = 'rag_documentos'::regclass AND attname = 'sensibilidad'`
      );
      assert.equal(conColumnas[0]?.['n'], 1);
    }));

  it('si otra ingesta reemplaza el documento mientras se reclasifica, no queda huella nueva con la clase vieja', () =>
    conEsquema(async (e) => {
      await asegurarEsquemaRag(e.sql);
      const documento = (
        huella: string,
        sensibilidad: DocumentoAGuardar['sensibilidad'],
        proyecto: string
      ): DocumentoAGuardar => ({
        id: 'carrera-1',
        driveFileId: 'drive-carrera-1',
        ruta: 'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/02_Proyecto/a.md',
        titulo: 'Carrera',
        empresa: 'dealer-solutions',
        cliente: 'Grupo Norte',
        proyecto,
        sensibilidad,
        participantes: [],
        frontmatter: {},
        huella,
        modeloEmb: 'modelo',
        fragmentos: [0, 1, 2].map((orden) => ({
          orden,
          seccion: 'resumen',
          texto: `texto ${huella} ${orden}`,
          tokens: 3,
          embedding: vectorDeterminista(`${huella} ${orden}`)
        }))
      });
      await guardarDocumento(e.sql, documento('H1', 'general', 'Portal'));

      // La otra ingesta: reemplaza el documento por contenido nuevo (H2, general)
      // y deja su transaccion abierta, con la fila vieja bloqueada.
      const otro = await e.pool.connect();
      try {
        await otro.query('BEGIN');
        const sqlDelOtro: Sql = {
          ejecutar: async (texto, parametros = []) =>
            (await otro.query(texto, parametros)).rows as Fila[],
          transaccion: async (f) =>
            f(
              async (texto, parametros = []) =>
                (await otro.query(texto, parametros)).rows as Fila[]
            )
        };
        await guardarDocumento(sqlDelOtro, documento('H2', 'general', 'Nuevo'));

        // Esta ingesta leyo H1 y quiere pasarlo a costos (se movio a 04_Costos).
        let terminada = false;
        const reclasificacion = saltarSiNoCambio(
          e.sql,
          documento('H1', 'costos', 'Portal')
        ).finally(() => {
          terminada = true;
        });
        await esperarBloqueo(e);
        assert.equal(
          terminada,
          false,
          'no debio avanzar sobre la fila bloqueada'
        );
        await otro.query('COMMIT');
        const resultado = await reclasificacion;

        const doc = await e.filas(
          'SELECT huella, sensibilidad, proyecto FROM rag_documentos'
        );
        const frags = await e.filas(
          'SELECT sensibilidad, proyecto, texto FROM rag_fragmentos ORDER BY orden'
        );
        assert.equal(doc.length, 1);
        assert.equal(doc[0]?.['huella'], 'H2');
        assert.equal(doc[0]?.['sensibilidad'], 'general');
        assert.equal(doc[0]?.['proyecto'], 'Nuevo');
        assert.equal(frags.length, 3);
        for (const f of frags) {
          assert.match(String(f['texto']), /texto H2/);
          assert.equal(f['sensibilidad'], 'general');
          assert.equal(f['proyecto'], 'Nuevo');
        }
        assert.equal(resultado, undefined, 'debio pedir la ingesta completa');
      } finally {
        await otro.query('ROLLBACK').catch(() => undefined);
        otro.release();
      }
    }));
});

// ---------------------------------------------------------------------------
// Ingesta de punta a punta (POST /ingesta/rag) contra el esquema real.

const RUTA_PROYECTO =
  'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal';

function markdownDe(titulo: string, frontmatter = '', extra = ''): string {
  const frente = frontmatter ? `---\n${frontmatter}\n---\n\n` : '';
  return `${frente}# ${titulo}

## Resumen

Resumen de ${titulo}: se acordo el alcance del modulo.

## Acuerdos

- Entregar ${titulo} el viernes.

## Transcripción

**Ana:** Revisamos ${titulo} con detalle.
**Luis:** Queda pendiente la fecha de ${titulo}.
${extra ? `\n${extra}\n` : ''}`;
}

describe('ingesta del RAG contra Postgres real', { skip: OMITIR }, () => {
  let esquema: EsquemaPrueba;
  let dir: string;
  let router: Awaited<ReturnType<typeof construirRutas>>;
  let embeddingsPedidos = 0;

  class PersistenciaConSql extends PersistenciaArchivos {
    readonly sql: Sql;
    constructor(dirs: Record<string, string>, sql: Sql) {
      super(dirs);
      this.sql = sql;
    }
  }

  before(async () => {
    esquema = await abrirEsquemaAleatorio(url as string);
    dir = await mkdtemp(join(tmpdir(), 'puente-rag-pg-'));
    const persistencia = new PersistenciaConSql(
      {
        datos: join(dir, 'datos'),
        ingesta: join(dir, 'ingesta'),
        correo: join(dir, 'correo'),
        integraciones: join(dir, 'integraciones')
      },
      esquema.sql
    );
    const config = leerConfiguracion({
      PUENTE_ADMIN_TOKEN: 'admin-prueba',
      OPENROUTER_API_KEY: 'sk-test',
      INGESTA_CLIENTES: 'fireflies|tok-rag|rag|ops|0'
    });
    const datos = abrirDatos(persistencia);
    await cargarDatos(datos, persistencia);
    router = construirRutas(
      config,
      undefined,
      persistencia,
      undefined,
      undefined,
      undefined,
      datos,
      []
    );
    establecerGanchosRag({
      embeddings: async (_config, textos) => {
        embeddingsPedidos += textos.length;
        return textos.map((t) => vectorDeterminista(t));
      }
    });
  });

  after(async () => {
    establecerGanchosRag({});
    await esquema?.cerrar();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function ingerir(cuerpo: Record<string, unknown>) {
    return (await router.resolver(
      '/ingesta/rag',
      new URLSearchParams(),
      'POST',
      cuerpo,
      { authorization: 'Bearer tok-rag' }
    )) as { omitido: boolean; fragmentos: number; id: string };
  }

  async function guardado(driveFileId: string) {
    const doc = await esquema.filas(
      `SELECT id, ruta, sensibilidad, proyecto FROM rag_documentos WHERE drive_file_id = $1`,
      [driveFileId]
    );
    const frags = await esquema.filas(
      `SELECT f.id::text AS id, f.sensibilidad, f.proyecto, f.xmin::text AS xmin
           FROM rag_fragmentos f JOIN rag_documentos d ON d.id = f.documento_id
          WHERE d.drive_file_id = $1 ORDER BY f.orden`,
      [driveFileId]
    );
    return { doc: doc[0] as Fila, frags };
  }

  const CASOS: {
    nombre: string;
    ruta?: string;
    /** Lineas del frontmatter, a partir del primer byte. */
    frontmatter?: string;
    /** Texto antes del frontmatter (para que no empiece en el byte 0). */
    antes?: string;
    /** Texto que se agrega al final del cuerpo. */
    extra?: string;
    sensibilidad: string;
    proyecto: string | null;
  }[] = [
    {
      nombre: 'un documento bajo 04_Costos es costos',
      ruta: `${RUTA_PROYECTO}/04_Costos/lista.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'un documento bajo 01_Cotizaciones es costos',
      ruta: `${RUTA_PROYECTO}/01_Cotizaciones/2026-10/COT-1.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una ficha con sensibilidad: costos en el frontmatter es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/ficha.md`,
      frontmatter: 'sensibilidad: costos',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'un documento normal bajo 02_Proyecto es general',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/alcance.md`,
      sensibilidad: 'general',
      proyecto: 'Portal'
    },
    {
      nombre: 'un documento de entregables es general',
      ruta: `${RUTA_PROYECTO}/03_Entregables/manual.md`,
      sensibilidad: 'general',
      proyecto: 'Portal'
    },
    {
      nombre: 'un documento sin ruta es costos y sin proyecto',
      frontmatter: 'empresa: Dealer Solutions',
      sensibilidad: 'costos',
      proyecto: null
    },
    {
      nombre: 'general en el frontmatter no baja un documento de 04_Costos',
      ruta: `${RUTA_PROYECTO}/04_Costos/margen.md`,
      frontmatter: 'sensibilidad: general',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una junta con el frontmatter de siempre sigue siendo general',
      ruta: 'Empresas/Itech Dev/TPI Composites/02_Proyecto/Juntas/2026-10-06_facturacion.md',
      frontmatter: 'cliente: TPI Composites\nproyecto: Facturacion',
      sensibilidad: 'general',
      proyecto: 'Facturacion'
    },
    {
      nombre:
        'CLIENTE.md fuera de las carpetas generales es costos y sin proyecto',
      ruta: 'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/CLIENTE.md',
      sensibilidad: 'costos',
      proyecto: null
    },
    {
      nombre:
        'PROYECTO_*.md fuera de las carpetas generales es costos, con su proyecto',
      ruta: `${RUTA_PROYECTO}/PROYECTO_Portal.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una ficha PROYECTO_*.md con sensibilidad: general es general',
      ruta: `${RUTA_PROYECTO}/PROYECTO_Portal.md`,
      frontmatter: 'sensibilidad: general',
      sensibilidad: 'general',
      proyecto: 'Portal'
    },
    {
      nombre: 'COTIZACION_x.md dentro de 02_Proyecto es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/COTIZACION_x.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'Propuesta_economica.md dentro de 03_Entregables es costos',
      ruta: `${RUTA_PROYECTO}/03_Entregables/Propuesta_economica.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'COTIZACION_x.md con sensibilidad: general explicito es general',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/COTIZACION_y.md`,
      frontmatter: 'sensibilidad: general',
      sensibilidad: 'general',
      proyecto: 'Portal'
    },
    {
      nombre: 'una carpeta Cotizaciones sin numero es costos',
      ruta: `${RUTA_PROYECTO}/Cotizaciones/resumen.md`,
      sensibilidad: 'costos',
      proyecto: null
    },
    {
      nombre: 'la llave repetida (costos y despues general) es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/duplicada.md`,
      frontmatter: 'sensibilidad: costos\nsensibilidad: general',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'un frontmatter que no empieza en el primer byte se lee igual',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/desplazada.md`,
      antes: '\n\n',
      frontmatter: 'sensibilidad: costos',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'Tarifas.md dentro de 02_Proyecto es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/Tarifas.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'Propuesta_Comercial_v2.md dentro de 03_Entregables es costos',
      ruta: `${RUTA_PROYECTO}/03_Entregables/Propuesta_Comercial_v2.md`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una junta que menciona $1,200 es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/Juntas/2026-10-06_revision.md`,
      extra: 'Quedo en $1,200 mensuales.',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una junta que menciona +IVA es costos',
      ruta: `${RUTA_PROYECTO}/Juntas/2026-10-07_revision.md`,
      extra: 'El total es +IVA.',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una junta que menciona MXN es costos',
      ruta: `${RUTA_PROYECTO}/Juntas/2026-10-08_revision.md`,
      extra: 'Son 15000 MXN.',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: 'una junta sin cifras ni palabras de precios es general',
      ruta: `${RUTA_PROYECTO}/Juntas/2026-10-09_revision.md`,
      extra: 'Se acordo la fecha de entrega.',
      sensibilidad: 'general',
      proyecto: 'Portal'
    },
    {
      nombre: 'sensibilidad: general valido libera una ficha con cifras',
      ruta: 'Empresas/Dealer Solutions/Grupo Norte/CLIENTE.md',
      frontmatter: 'sensibilidad: general',
      extra: 'Presupuesto de $5,000 MXN +IVA.',
      sensibilidad: 'general',
      proyecto: null
    },
    {
      nombre: 'general dentro de un bloque de codigo no libera una ficha',
      ruta: 'Empresas/Dealer Solutions/Grupo Norte/CLIENTE.md',
      extra: '```yaml\nsensibilidad: general\n```',
      sensibilidad: 'costos',
      proyecto: null
    },
    {
      nombre:
        'general dentro de un bloque de codigo no libera un documento con cifras',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/plantilla.md`,
      extra: '```yaml\nsensibilidad: general\n```\n\nTotal $100.',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre: '**Sensibilidad:** costos despues de la linea 60 es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/larga.md`,
      extra: `${'linea de relleno\n'.repeat(80)}\n**Sensibilidad:** costos`,
      sensibilidad: 'costos',
      proyecto: 'Portal'
    },
    {
      nombre:
        'frontmatter general valido mas sensibilidad: costos en el cuerpo es costos',
      ruta: `${RUTA_PROYECTO}/02_Proyecto/mixta.md`,
      frontmatter: 'sensibilidad: general',
      extra: '> sensibilidad: costos',
      sensibilidad: 'costos',
      proyecto: 'Portal'
    }
  ];

  for (const [i, caso] of CASOS.entries()) {
    it(`guarda en el documento y en todos sus fragmentos: ${caso.nombre}`, async () => {
      const driveFileId = `drive-caso-${i}`;
      const respuesta = await ingerir({
        driveFileId,
        markdown:
          (caso.antes ?? '') +
          markdownDe(`Caso ${i}`, caso.frontmatter, caso.extra),
        ...(caso.ruta ? { ruta: caso.ruta } : {})
      });
      assert.equal(respuesta.omitido, false);
      assert.ok(respuesta.fragmentos >= 3);
      const { doc, frags } = await guardado(driveFileId);
      assert.equal(doc['sensibilidad'], caso.sensibilidad);
      assert.equal(doc['proyecto'], caso.proyecto);
      assert.equal(frags.length, respuesta.fragmentos);
      for (const f of frags) {
        assert.equal(f['sensibilidad'], caso.sensibilidad);
        assert.equal(f['proyecto'], caso.proyecto);
      }
    });
  }

  it('con la misma huella y una ruta nueva en 04_Costos reclasifica todos los fragmentos sin embeber ni reinsertar', async () => {
    const markdown = markdownDe('Movido');
    const inicial = await ingerir({
      driveFileId: 'drive-movido',
      markdown,
      ruta: `${RUTA_PROYECTO}/02_Proyecto/movido.md`
    });
    const antes = await guardado('drive-movido');
    assert.equal(antes.doc['sensibilidad'], 'general');
    assert.ok(antes.frags.length >= 3);
    const pedidosAntes = embeddingsPedidos;

    const movido = await ingerir({
      driveFileId: 'drive-movido',
      markdown,
      ruta: `${RUTA_PROYECTO}/04_Costos/movido.md`
    });

    assert.equal(movido.omitido, true);
    assert.equal(movido.id, inicial.id);
    assert.equal(embeddingsPedidos, pedidosAntes, 'volvio a pedir embeddings');
    const despues = await guardado('drive-movido');
    assert.equal(despues.doc['sensibilidad'], 'costos');
    assert.equal(despues.doc['ruta'], `${RUTA_PROYECTO}/04_Costos/movido.md`);
    assert.equal(despues.frags.length, antes.frags.length);
    assert.deepEqual(
      despues.frags.map((f) => f['id']),
      antes.frags.map((f) => f['id']),
      'los fragmentos se borraron y se volvieron a insertar'
    );
    for (const f of despues.frags) {
      assert.equal(f['sensibilidad'], 'costos');
      assert.equal(f['proyecto'], 'Portal');
    }
    // Y de regreso a una carpeta normal.
    await ingerir({
      driveFileId: 'drive-movido',
      markdown,
      ruta: `${RUTA_PROYECTO}/03_Entregables/movido.md`
    });
    const regreso = await guardado('drive-movido');
    assert.equal(regreso.doc['sensibilidad'], 'general');
    assert.ok(regreso.frags.every((f) => f['sensibilidad'] === 'general'));
    assert.equal(embeddingsPedidos, pedidosAntes);
  });

  it('reenviar lo mismo no reescribe ninguna fila', async () => {
    const markdown = markdownDe('Igual');
    const ruta = `${RUTA_PROYECTO}/02_Proyecto/igual.md`;
    await ingerir({
      driveFileId: 'drive-igual',
      markdown,
      ruta,
      driveUrl: 'https://drive.google.com/file/d/drive-igual/view',
      modificadoEn: '2026-10-06T18:00:00.000Z'
    });
    const antes = await guardado('drive-igual');
    const otra = await ingerir({
      driveFileId: 'drive-igual',
      markdown,
      ruta,
      driveUrl: 'https://drive.google.com/file/d/drive-igual/view',
      modificadoEn: '2026-10-06T18:00:00.000Z'
    });
    assert.equal(otra.omitido, true);
    const despues = await guardado('drive-igual');
    assert.deepEqual(
      despues.frags.map((f) => f['xmin']),
      antes.frags.map((f) => f['xmin']),
      'reescribio fragmentos que no habian cambiado'
    );
  });

  it('corrige fragmentos que quedaron con el valor por omision aunque el documento ya estuviera bien', async () => {
    const markdown = markdownDe('Migrado');
    const ruta = `${RUTA_PROYECTO}/02_Proyecto/migrado.md`;
    await ingerir({ driveFileId: 'drive-migrado', markdown, ruta });
    // Lo que dejo la migracion en una fila indexada antes de las columnas.
    await esquema.sql.ejecutar(
      `UPDATE rag_fragmentos SET sensibilidad = 'costos', proyecto = NULL
          WHERE documento_id = (SELECT id FROM rag_documentos WHERE drive_file_id = 'drive-migrado')`
    );
    const pedidosAntes = embeddingsPedidos;
    const otra = await ingerir({
      driveFileId: 'drive-migrado',
      markdown,
      ruta
    });
    assert.equal(otra.omitido, true);
    assert.equal(embeddingsPedidos, pedidosAntes);
    const { doc, frags } = await guardado('drive-migrado');
    assert.equal(doc['sensibilidad'], 'general');
    assert.ok(frags.length >= 3);
    for (const f of frags) {
      assert.equal(f['sensibilidad'], 'general');
      assert.equal(f['proyecto'], 'Portal');
    }
  });

  it('buscarHibrido sigue funcionando sobre el esquema nuevo', async () => {
    const marcado = 'Resumen de Caso 3: se acordo el alcance del modulo.';
    const fila = await esquema.filas(
      `SELECT texto FROM rag_fragmentos WHERE texto LIKE '%' || $1 || '%' LIMIT 1`,
      [marcado]
    );
    const texto = String(fila[0]?.['texto']);
    const clausula = resolverEmpresas(
      { pregunta: 'Caso 3 alcance del modulo', empresa: 'dealer-solutions' },
      director
    );
    const hallados = await buscarHibrido(
      esquema.sql,
      'Caso 3 alcance del modulo',
      vectorDeterminista(texto),
      { clausula },
      5
    );
    assert.ok(hallados.length > 0);
    assert.equal(hallados[0]?.texto, texto);
    assert.equal(hallados[0]?.proyecto, 'Portal');
    assert.equal(hallados[0]?.empresa, 'dealer-solutions');
    // Solo texto: una pregunta que ningun vector reconoce igual encuentra por palabras.
    const porTexto = await buscarHibrido(
      esquema.sql,
      'alcance modulo',
      vectorDeterminista('otra cosa distinta'),
      { clausula },
      5
    );
    assert.ok(porTexto.some((h) => /alcance del modulo/.test(h.texto)));
  });
});
