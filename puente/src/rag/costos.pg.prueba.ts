import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import { PersistenciaArchivos, type Sql } from '../datos/persistencia.js';
import type { UsuarioCrm } from '../nucleo/contrato.js';
import {
  abrirDatos,
  cargarDatos,
  construirRutas,
  type Datos
} from '../servidor/rutas.js';
import { establecerGanchosRag } from '../servidor/rutas-rag.js';
import { resolverEmpresas, type ActorRag } from './alcance.js';
import { avisarSiFaltaBackfill, buscarHibrido } from './almacen-vectorial.js';
import { asegurarEsquemaRag } from './esquema.js';
import {
  abrirEsquemaAleatorio,
  urlDePrueba,
  vectorDeterminista,
  type EsquemaPrueba
} from './pg-prueba.js';

/**
 * Filtro de costos y realineacion al mover archivos (ADR-0001, decisiones 9,
 * 11 y 13) contra un Postgres 16 con pgvector de verdad. Se omiten solas sin
 * TEST_DATABASE_URL; ver pg-prueba.ts.
 *
 * Los documentos se siembran por POST /ingesta/rag, con el clasificador real:
 * lo que es costos lo decide la ruta, no la prueba. Cada documento lleva una
 * palabra propia (sin cifras de dinero) para reconocerlo.
 */
const url = urlDePrueba();
const OMITIR = url ? false : 'sin TEST_DATABASE_URL: no hay Postgres de prueba';

const CLIENTE_A = 'Empresas/Operativ AI/Cliente A/Portal';
const CLIENTE_B = 'Empresas/Dealer Solutions/Cliente B/Taller';

function markdownDe(titulo: string, palabra: string, frente = ''): string {
  const frontmatter = frente ? `---\n${frente}\n---\n\n` : '';
  return `${frontmatter}# ${titulo}

## Resumen

Resumen de ${titulo}: el modulo ${palabra} quedo definido.

## Acuerdos

- Entregar ${palabra} el viernes.
`;
}

interface Hallado {
  titulo: string;
  driveFileId: string;
  texto: string;
  empresa: string;
  cliente: string | null;
}

interface Entorno {
  esquema: EsquemaPrueba;
  datos: Datos;
  router: Awaited<ReturnType<typeof construirRutas>>;
  /** Cuantos textos se han mandado a embeber (la ingesta y las preguntas). */
  embeddings: () => number;
  /** Lo que recibio el modelo en la ultima respuesta redactada. */
  ultimoPrompt: () => string;
  ingerir(cuerpo: Record<string, unknown>): Promise<{
    omitido: boolean;
    empresa: string;
    fragmentos: number;
  }>;
  buscar(token: string, cuerpo?: Record<string, unknown>): Promise<Hallado[]>;
  preguntar(
    token: string,
    pregunta: string
  ): Promise<{
    respuesta: string;
    fuentes: { titulo: string; driveFileId: string }[];
  }>;
  cerrar(): Promise<void>;
}

class PersistenciaConSql extends PersistenciaArchivos {
  readonly sql: Sql;
  constructor(dirs: Record<string, string>, sql: Sql) {
    super(dirs);
    this.sql = sql;
  }
}

const ACCESO = {
  ACCESO_CORREOS: 'ana@ejemplo.test',
  EMAILJS_SERVICE_ID: 's',
  EMAILJS_TEMPLATE_ID: 't',
  EMAILJS_PUBLIC_KEY: 'p',
  EMAILJS_PRIVATE_KEY: 'k'
};

async function sembrar(
  datos: Datos,
  correo: string,
  token: string,
  roles: string[],
  alcance?: UsuarioCrm['alcance']
): Promise<void> {
  await datos.usuariosCrm.escribir([
    ...datos.usuariosCrm.leer(),
    {
      id: correo,
      correo,
      nombre: 'Prueba',
      roles,
      ...(alcance ? { alcance } : {}),
      activo: true,
      actualizadoEn: '2026-10-01T00:00:00.000Z'
    }
  ]);
  await sesion(datos, token, correo);
}

async function sesion(
  datos: Datos,
  token: string,
  correo: string
): Promise<void> {
  await datos.sesiones.escribir([
    ...datos.sesiones.leer(),
    {
      token,
      correo,
      creada: '2026-10-01T00:00:00.000Z',
      vence: '2999-01-01T00:00:00.000Z'
    }
  ]);
}

async function abrirEntorno(): Promise<Entorno> {
  const esquema = await abrirEsquemaAleatorio(url as string);
  const dir = await mkdtemp(join(tmpdir(), 'puente-rag-costos-'));
  let pedidos = 0;
  let prompt = '';
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
    INGESTA_CLIENTES:
      'fireflies|tok-rag|rag|ops|0;dealer|tok-dealer|rag-consulta|ops|0|dealer-solutions;operativ|tok-operativ|rag-consulta|ops|0|operativai',
    ...ACCESO
  });
  const datos = abrirDatos(persistencia);
  await cargarDatos(datos, persistencia);
  const router = construirRutas(
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
      pedidos += textos.length;
      return textos.map((t) => vectorDeterminista(t));
    },
    redactar: async (_sistema, usuario) => {
      prompt = usuario;
      return 'Respuesta de prueba.';
    }
  });
  // Felipe: finanzas (area costos en lectura), solo Operativ AI.
  await sembrar(datos, 'felipe@ejemplo.test', 'tok-felipe', ['finanzas'], {
    empresas: ['operativai']
  });
  // Misma empresa, sin el area costos (tiene cotizaciones, que no lo concede).
  await sembrar(datos, 'ventas@ejemplo.test', 'tok-ventas', ['comercial'], {
    empresas: ['operativai']
  });
  // Sin alcance definido: ve lo que su rol permite en todas las empresas.
  await sembrar(datos, 'libre@ejemplo.test', 'tok-libre', ['comercial']);
  // Dueno por ACCESO_CORREOS, sin registro de usuario.
  await sesion(datos, 'tok-ana', 'ana@ejemplo.test');

  const resolver = (
    ruta: string,
    cuerpo: Record<string, unknown>,
    token: string
  ) =>
    router.resolver(ruta, new URLSearchParams(), 'POST', cuerpo, {
      authorization: `Bearer ${token}`
    });
  return {
    esquema,
    datos,
    router,
    embeddings: () => pedidos,
    ultimoPrompt: () => prompt,
    ingerir: async (cuerpo) =>
      (await resolver('/ingesta/rag', cuerpo, 'tok-rag')) as Awaited<
        ReturnType<Entorno['ingerir']>
      >,
    buscar: async (token, cuerpo = {}) =>
      (
        (await resolver(
          '/rag/buscar',
          { pregunta: 'definido', k: 20, ...cuerpo },
          token
        )) as { fragmentos: Hallado[] }
      ).fragmentos,
    preguntar: async (token, pregunta) =>
      (await resolver('/rag/preguntar', { pregunta, k: 20 }, token)) as Awaited<
        ReturnType<Entorno['preguntar']>
      >,
    cerrar: async () => {
      establecerGanchosRag({});
      await esquema.cerrar();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** Lo que el modelo recibe como fragmentos (sin la pregunta, que repite la palabra). */
function fragmentosDelPrompt(prompt: string): string {
  return prompt.split('Fragmentos:')[1] ?? '';
}

/** Los drive ids distintos que devolvio una busqueda, ordenados. */
function documentos(hallados: readonly Hallado[]): string[] {
  return [...new Set(hallados.map((h) => h.driveFileId))].sort();
}

describe('filtro de costos contra Postgres real', { skip: OMITIR }, () => {
  let e: Entorno;

  // Documentos generales y de costos, en dos empresas.
  const GENERALES_OPERATIV = ['drive-op-general'];
  const COSTOS_OPERATIV = [
    'drive-op-costos',
    'drive-op-cotizacion',
    'drive-op-ficha'
  ];
  const GENERALES_DEALER = ['drive-ds-general'];
  const COSTOS_DEALER = ['drive-ds-costos', 'drive-ds-sin-clasificar'];

  before(async () => {
    e = await abrirEntorno();
    const docs: [string, string, string, string, string?][] = [
      [
        'drive-op-general',
        `${CLIENTE_A}/02_Proyecto/alcance.md`,
        'OP alcance',
        'ambar'
      ],
      [
        'drive-op-costos',
        `${CLIENTE_A}/04_Costos/lista.md`,
        'OP lista',
        'zafiro'
      ],
      [
        'drive-op-cotizacion',
        `${CLIENTE_A}/01_Cotizaciones/2026-10/COT-1.md`,
        'OP cotizacion',
        'rubi'
      ],
      [
        'drive-op-ficha',
        `${CLIENTE_A}/02_Proyecto/ficha.md`,
        'OP ficha',
        'topacio',
        'sensibilidad: costos'
      ],
      [
        'drive-ds-general',
        `${CLIENTE_B}/02_Proyecto/alcance.md`,
        'DS alcance',
        'cuarzo'
      ],
      [
        'drive-ds-costos',
        `${CLIENTE_B}/04_Costos/lista.md`,
        'DS lista',
        'esmeralda'
      ]
    ];
    for (const [driveFileId, ruta, titulo, palabra, frente] of docs) {
      const r = await e.ingerir({
        driveFileId,
        ruta,
        markdown: markdownDe(titulo, palabra, frente)
      });
      assert.equal(r.omitido, false, driveFileId);
    }
    // Un fragmento indexado por codigo viejo, que no menciona la sensibilidad:
    // el DEFAULT lo deja como costos.
    await e.esquema.sql.ejecutar(
      `INSERT INTO rag_documentos
         (id, drive_file_id, ruta, titulo, empresa, cliente, proyecto, huella, modelo_emb)
       VALUES ('drive-ds-sin-clasificar', 'drive-ds-sin-clasificar',
               '${CLIENTE_B}/02_Proyecto/viejo.md', 'DS viejo', 'dealer-solutions',
               'Cliente B', 'Taller', 'h-viejo', 'modelo')`
    );
    await e.esquema.sql.ejecutar(
      `INSERT INTO rag_fragmentos
         (documento_id, orden, seccion, empresa, cliente, texto, tokens, embedding)
       VALUES ('drive-ds-sin-clasificar', 0, 'resumen', 'dealer-solutions',
               'Cliente B', 'El modulo obsidiana quedo definido.', 8, $1::halfvec)`,
      [`[${vectorDeterminista('obsidiana').join(',')}]`]
    );
  });

  after(async () => {
    await e?.cerrar();
  });

  it('los documentos se clasifican como se espera (la base de las demas pruebas)', async () => {
    const filas = await e.esquema.filas(
      `SELECT d.drive_file_id, d.sensibilidad AS doc, f.sensibilidad AS frag
         FROM rag_documentos d JOIN rag_fragmentos f ON f.documento_id = d.id`
    );
    const por = new Map<string, Set<string>>();
    for (const f of filas) {
      const clave = String(f['drive_file_id']);
      const set = por.get(clave) ?? new Set<string>();
      set.add(`${f['doc']}/${f['frag']}`);
      por.set(clave, set);
    }
    for (const id of [...GENERALES_OPERATIV, ...GENERALES_DEALER]) {
      assert.deepEqual([...(por.get(id) ?? [])], ['general/general'], id);
    }
    for (const id of [...COSTOS_OPERATIV, ...COSTOS_DEALER]) {
      assert.deepEqual([...(por.get(id) ?? [])], ['costos/costos'], id);
    }
  });

  it('el director y el token de admin ven costos y generales de todas las empresas', async () => {
    const todos = [
      ...GENERALES_OPERATIV,
      ...COSTOS_OPERATIV,
      ...GENERALES_DEALER,
      ...COSTOS_DEALER
    ].sort();
    for (const token of ['admin-prueba', 'tok-ana']) {
      assert.deepEqual(documentos(await e.buscar(token)), todos, token);
    }
  });

  it('Felipe (area costos en lectura) ve los costos y los generales de su empresa, y nada de otras', async () => {
    const hallados = await e.buscar('tok-felipe');
    assert.deepEqual(
      documentos(hallados),
      [...GENERALES_OPERATIV, ...COSTOS_OPERATIV].sort()
    );
    // La peticion solo puede reducir su alcance, no ampliarlo.
    await assert.rejects(
      () => e.buscar('tok-felipe', { empresa: 'dealer-solutions' }),
      (error: unknown) => (error as { estado?: number }).estado === 403
    );
  });

  it('quien no tiene costos solo recupera documentos generales', async () => {
    assert.deepEqual(
      documentos(await e.buscar('tok-ventas')),
      GENERALES_OPERATIV
    );
    assert.deepEqual(
      documentos(await e.buscar('tok-libre')),
      [...GENERALES_OPERATIV, ...GENERALES_DEALER].sort()
    );
  });

  it('los tokens rag-consulta no ven costos', async () => {
    assert.deepEqual(
      documentos(await e.buscar('tok-dealer')),
      GENERALES_DEALER
    );
    assert.deepEqual(
      documentos(await e.buscar('tok-operativ')),
      GENERALES_OPERATIV
    );
  });

  it('pedir costos en la peticion no los concede', async () => {
    const intentos = [
      { incluirCostos: true },
      { costos: true },
      { puedeCostos: true },
      { sensibilidad: 'costos' },
      { sensibilidad: ['general', 'costos'] },
      { permisos: { costos: 'lectura' } }
    ];
    for (const intento of intentos) {
      assert.deepEqual(
        documentos(await e.buscar('tok-ventas', intento)),
        GENERALES_OPERATIV,
        JSON.stringify(intento)
      );
      assert.deepEqual(
        documentos(await e.buscar('tok-dealer', intento)),
        GENERALES_DEALER,
        JSON.stringify(intento)
      );
    }
  });

  it('preguntar no cita ni manda al modelo fragmentos de costos a quien no los ve', async () => {
    const palabras = ['zafiro', 'rubi', 'topacio', 'esmeralda', 'obsidiana'];
    for (const token of ['tok-ventas', 'tok-operativ', 'tok-dealer']) {
      for (const palabra of palabras) {
        const respuesta = await e.preguntar(token, `que es ${palabra}`);
        assert.ok(respuesta.fuentes.length > 0, token);
        for (const fuente of respuesta.fuentes) {
          assert.ok(
            [...GENERALES_OPERATIV, ...GENERALES_DEALER].includes(
              fuente.driveFileId
            ),
            `${token} cito ${fuente.driveFileId}`
          );
        }
        assert.doesNotMatch(
          fragmentosDelPrompt(e.ultimoPrompt()),
          new RegExp(palabras.join('|')),
          `${token} ${palabra}`
        );
      }
    }
    // Con permiso de costos, la misma pregunta si los cita.
    const felipe = await e.preguntar('tok-felipe', 'que es zafiro');
    assert.ok(felipe.fuentes.some((f) => f.driveFileId === 'drive-op-costos'));
    assert.match(fragmentosDelPrompt(e.ultimoPrompt()), /zafiro/);
  });

  describe('cada rama de la busqueda filtra por su cuenta', () => {
    const sinCostos: ActorRag = {
      director: false,
      puedeItech: false,
      puedeCostos: false
    };
    const conCostos: ActorRag = { ...sinCostos, puedeCostos: true };

    /** Una sola rama: la otra devuelve vacio, para que la prueba no la tape. */
    function soloRama(rama: 'vector' | 'texto'): Sql {
      return {
        ejecutar: async (texto, parametros) => {
          const esVector = texto.includes('ORDER BY f.embedding');
          if (
            texto.includes('FROM rag_fragmentos') &&
            (rama === 'vector') !== esVector
          ) {
            return [];
          }
          return e.esquema.sql.ejecutar(texto, parametros);
        },
        transaccion: e.esquema.sql.transaccion
      };
    }

    const CASOS: [string, string][] = [
      ['drive-op-costos', 'zafiro'],
      ['drive-op-cotizacion', 'rubi'],
      ['drive-op-ficha', 'topacio'],
      ['drive-ds-costos', 'esmeralda'],
      ['drive-ds-sin-clasificar', 'obsidiana']
    ];

    /** El embedding guardado de su primer fragmento: la distancia a el es cero. */
    async function vectorDe(driveFileId: string): Promise<number[]> {
      const filas = await e.esquema.filas(
        `SELECT f.embedding::text AS v FROM rag_fragmentos f
           JOIN rag_documentos d ON d.id = f.documento_id
          WHERE d.drive_file_id = $1 ORDER BY f.orden LIMIT 1`,
        [driveFileId]
      );
      return JSON.parse(String(filas[0]?.['v'])) as number[];
    }

    for (const [driveFileId, palabra] of CASOS) {
      it(`${driveFileId}: la rama de texto no lo devuelve sin permiso (y con permiso si)`, async () => {
        const rama = soloRama('texto');
        // Un vector sin relacion: solo cuenta la coincidencia de palabras.
        const vector = vectorDeterminista('nada que ver');
        const pedir = (actor: ActorRag) =>
          buscarHibrido(
            rama,
            palabra,
            vector,
            { clausula: resolverEmpresas({ pregunta: palabra }, actor) },
            20
          );
        assert.deepEqual(
          documentos(await pedir(conCostos)),
          [driveFileId],
          'control: con permiso la rama de texto lo encuentra'
        );
        assert.deepEqual(await pedir(sinCostos), []);
      });

      it(`${driveFileId}: la rama vectorial no lo devuelve sin permiso (y con permiso si)`, async () => {
        const rama = soloRama('vector');
        const vector = await vectorDe(driveFileId);
        // Palabras que ningun documento tiene: solo cuenta el vector.
        const pedir = (actor: ActorRag) =>
          buscarHibrido(
            rama,
            'qwxz',
            vector,
            { clausula: resolverEmpresas({ pregunta: 'qwxz' }, actor) },
            20
          );
        const con = await pedir(conCostos);
        assert.equal(
          con[0]?.driveFileId,
          driveFileId,
          'control: con permiso el vector exacto lo trae primero'
        );
        const sin = await pedir(sinCostos);
        assert.ok(sin.length > 0, 'la rama vectorial devuelve lo general');
        assert.ok(
          sin.every((h) =>
            [...GENERALES_OPERATIV, ...GENERALES_DEALER].includes(h.driveFileId)
          ),
          documentos(sin).join(',')
        );
      });
    }

    it('un desalineo entre fragmento y documento nunca abre costos', async () => {
      const aislado = await abrirEsquemaAleatorio(url as string);
      try {
        await asegurarEsquemaRag(aislado.sql);
        const vector = `[${vectorDeterminista('x').join(',')}]`;
        for (const [id, doc, frag] of [
          ['fragmento-general-doc-costos', 'costos', 'general'],
          ['fragmento-costos-doc-general', 'general', 'costos']
        ]) {
          await aislado.sql.ejecutar(
            `INSERT INTO rag_documentos
               (id, drive_file_id, titulo, empresa, huella, modelo_emb, sensibilidad)
             VALUES ($1, $1, $1, 'dealer-solutions', 'h', 'm', $2)`,
            [id, doc]
          );
          await aislado.sql.ejecutar(
            `INSERT INTO rag_fragmentos
               (documento_id, orden, empresa, texto, embedding, sensibilidad)
             VALUES ($1, 0, 'dealer-solutions', 'texto de prueba', $2::halfvec, $3)`,
            [id, vector, frag]
          );
        }
        const pedir = (actor: ActorRag) =>
          buscarHibrido(
            aislado.sql,
            'prueba',
            vectorDeterminista('x'),
            { clausula: resolverEmpresas({ pregunta: 'prueba' }, actor) },
            20
          );
        assert.deepEqual(await pedir(sinCostos), []);
        assert.equal((await pedir(conCostos)).length, 2);
      } finally {
        await aislado.cerrar();
      }
    });
  });

  it('preguntar por una palabra que solo esta en costos da lo mismo que por una inexistente', async () => {
    const costos = await e.buscar('tok-dealer', { pregunta: 'esmeralda' });
    const inexistente = await e.buscar('tok-dealer', { pregunta: 'qwxz' });
    assert.deepEqual(documentos(costos), documentos(inexistente));
  });
});

describe(
  'aviso de backfill pendiente contra Postgres real',
  { skip: OMITIR },
  () => {
    it('avisa si lo indexado esta todo como costos y calla cuando ya hay generales', async () => {
      const esquema = await abrirEsquemaAleatorio(url as string);
      try {
        await asegurarEsquemaRag(esquema.sql);
        const avisos: string[] = [];
        await avisarSiFaltaBackfill(esquema.sql, (m) => avisos.push(m));
        assert.equal(avisos.length, 0, 'sin fragmentos no hay nada que avisar');
        await esquema.sql.ejecutar(
          `INSERT INTO rag_documentos (id, drive_file_id, titulo, empresa, huella, modelo_emb)
         VALUES ('d', 'd', 'D', 'dealer-solutions', 'h', 'm')`
        );
        await esquema.sql.ejecutar(
          `INSERT INTO rag_fragmentos (documento_id, orden, empresa, texto, embedding)
         VALUES ('d', 0, 'dealer-solutions', 't', $1::halfvec)`,
          [`[${vectorDeterminista('t').join(',')}]`]
        );
        await avisarSiFaltaBackfill(esquema.sql, (m) => avisos.push(m));
        assert.equal(avisos.length, 1);
        assert.match(avisos[0] ?? '', /rag:backfill/);
        await esquema.sql.ejecutar(
          `UPDATE rag_fragmentos SET sensibilidad = 'general'`
        );
        await avisarSiFaltaBackfill(esquema.sql, (m) => avisos.push(m));
        assert.equal(avisos.length, 1);
      } finally {
        await esquema.cerrar();
      }
    });
  }
);

describe(
  'realineacion de empresa y cliente al mover un archivo, contra Postgres real',
  { skip: OMITIR },
  () => {
    let e: Entorno;

    before(async () => {
      e = await abrirEntorno();
    });

    after(async () => {
      await e?.cerrar();
    });

    async function guardado(driveFileId: string) {
      const doc = await e.esquema.filas(
        `SELECT id, empresa, cliente, proyecto, sensibilidad, ruta
           FROM rag_documentos WHERE drive_file_id = $1`,
        [driveFileId]
      );
      const frags = await e.esquema.filas(
        `SELECT f.id::text AS id, f.empresa, f.cliente, f.proyecto, f.sensibilidad
           FROM rag_fragmentos f JOIN rag_documentos d ON d.id = f.documento_id
          WHERE d.drive_file_id = $1 ORDER BY f.orden`,
        [driveFileId]
      );
      return { doc: doc[0], frags };
    }

    it('un archivo movido a otra empresa se realinea sin embeber y deja de aparecer en la vieja', async () => {
      const markdown = markdownDe('Mudanza', 'granate');
      const antes = await e.ingerir({
        driveFileId: 'drive-mudanza',
        ruta: `${CLIENTE_B}/02_Proyecto/mudanza.md`,
        markdown
      });
      assert.equal(antes.empresa, 'dealer-solutions');
      const previo = await guardado('drive-mudanza');
      assert.equal(previo.doc?.['cliente'], 'Cliente B');
      assert.ok(previo.frags.length >= 2);
      assert.deepEqual(documentos(await e.buscar('tok-dealer')), [
        'drive-mudanza'
      ]);
      assert.deepEqual(await e.buscar('tok-operativ'), []);

      const pedidosAntes = e.embeddings();
      const movido = await e.ingerir({
        driveFileId: 'drive-mudanza',
        ruta: 'Empresas/Operativ AI/Cliente C/Otro/02_Proyecto/mudanza.md',
        markdown
      });
      assert.equal(movido.omitido, true);
      assert.equal(movido.empresa, 'operativai');
      assert.equal(e.embeddings(), pedidosAntes, 'volvio a pedir embeddings');

      const despues = await guardado('drive-mudanza');
      assert.equal(despues.doc?.['empresa'], 'operativai');
      assert.equal(despues.doc?.['cliente'], 'Cliente C');
      assert.equal(despues.doc?.['proyecto'], 'Otro');
      assert.deepEqual(
        despues.frags.map((f) => f['id']),
        previo.frags.map((f) => f['id']),
        'los fragmentos se borraron y se volvieron a insertar'
      );
      for (const f of despues.frags) {
        assert.equal(f['empresa'], 'operativai');
        assert.equal(f['cliente'], 'Cliente C');
        assert.equal(f['proyecto'], 'Otro');
      }
      // Ya no aparece en la empresa vieja, ni por empresa ni por cliente.
      assert.deepEqual(await e.buscar('tok-dealer'), []);
      assert.deepEqual(
        await e.buscar('tok-libre', { empresa: 'dealer-solutions' }),
        []
      );
      assert.deepEqual(
        await e.buscar('tok-libre', { cliente: 'Cliente B' }),
        []
      );
      // Y si aparece en la nueva.
      assert.deepEqual(documentos(await e.buscar('tok-operativ')), [
        'drive-mudanza'
      ]);
      assert.deepEqual(
        documentos(await e.buscar('tok-libre', { cliente: 'cliente c' })),
        ['drive-mudanza']
      );
    });

    it('mover a otro cliente de la misma empresa realinea el cliente', async () => {
      const markdown = markdownDe('Cambio de cliente', 'jade');
      await e.ingerir({
        driveFileId: 'drive-cliente',
        ruta: `${CLIENTE_B}/02_Proyecto/cliente.md`,
        markdown
      });
      const pedidosAntes = e.embeddings();
      const r = await e.ingerir({
        driveFileId: 'drive-cliente',
        ruta: 'Empresas/Dealer Solutions/Cliente D/Taller/02_Proyecto/cliente.md',
        markdown
      });
      assert.equal(r.omitido, true);
      assert.equal(e.embeddings(), pedidosAntes);
      const { doc, frags } = await guardado('drive-cliente');
      assert.equal(doc?.['empresa'], 'dealer-solutions');
      assert.equal(doc?.['cliente'], 'Cliente D');
      assert.ok(frags.every((f) => f['cliente'] === 'Cliente D'));
      assert.deepEqual(
        await e.buscar('tok-dealer', { cliente: 'Cliente B' }),
        []
      );
    });

    it('mover a otra empresa y a 04_Costos a la vez: cambia de empresa y deja de verlo quien no tiene costos', async () => {
      const markdown = markdownDe('Mudanza a costos', 'ambarino');
      await e.ingerir({
        driveFileId: 'drive-mudanza-costos',
        ruta: `${CLIENTE_B}/02_Proyecto/m.md`,
        markdown
      });
      assert.ok(
        documentos(await e.buscar('tok-dealer')).includes(
          'drive-mudanza-costos'
        )
      );
      await e.ingerir({
        driveFileId: 'drive-mudanza-costos',
        ruta: `${CLIENTE_A}/04_Costos/m.md`,
        markdown
      });
      const { doc, frags } = await guardado('drive-mudanza-costos');
      assert.equal(doc?.['empresa'], 'operativai');
      assert.equal(doc?.['sensibilidad'], 'costos');
      assert.ok(frags.every((f) => f['empresa'] === 'operativai'));
      assert.ok(frags.every((f) => f['sensibilidad'] === 'costos'));
      for (const token of ['tok-dealer', 'tok-operativ', 'tok-ventas']) {
        assert.ok(
          !documentos(await e.buscar(token)).includes('drive-mudanza-costos'),
          token
        );
      }
      assert.ok(
        documentos(await e.buscar('tok-felipe')).includes(
          'drive-mudanza-costos'
        )
      );
    });

    it('un fragmento que quedo con otra empresa que su documento se corrige al reenviar lo mismo', async () => {
      const markdown = markdownDe('Desalineado', 'cobalto');
      const ruta = `${CLIENTE_B}/02_Proyecto/desalineado.md`;
      await e.ingerir({ driveFileId: 'drive-desalineado', ruta, markdown });
      await e.esquema.sql.ejecutar(
        `UPDATE rag_fragmentos SET empresa = 'operativai', cliente = 'Otro'
          WHERE documento_id = (SELECT id FROM rag_documentos WHERE drive_file_id = 'drive-desalineado')`
      );
      assert.ok(
        documentos(await e.buscar('tok-operativ')).includes('drive-desalineado')
      );
      const r = await e.ingerir({
        driveFileId: 'drive-desalineado',
        ruta,
        markdown
      });
      assert.equal(r.omitido, true);
      assert.ok(
        !documentos(await e.buscar('tok-operativ')).includes(
          'drive-desalineado'
        )
      );
      assert.ok(
        documentos(await e.buscar('tok-dealer')).includes('drive-desalineado')
      );
    });

    it('reenviar lo mismo no reescribe ninguna fila', async () => {
      const markdown = markdownDe('Igual', 'onix');
      const cuerpo = {
        driveFileId: 'drive-igual',
        ruta: `${CLIENTE_B}/02_Proyecto/igual.md`,
        markdown
      };
      await e.ingerir(cuerpo);
      const xmin = async () =>
        (
          await e.esquema.filas(
            `SELECT f.xmin::text AS xmin FROM rag_fragmentos f
               JOIN rag_documentos d ON d.id = f.documento_id
              WHERE d.drive_file_id = 'drive-igual' ORDER BY f.orden`
          )
        ).map((f) => f['xmin']);
      const antes = await xmin();
      await e.ingerir(cuerpo);
      assert.deepEqual(await xmin(), antes);
    });

    // --- Conflicto entre el frontmatter y la ruta de Drive -------------------
    //
    // DECISION PENDIENTE DEL DUENO. Hoy el frontmatter `empresa:` manda sobre la
    // empresa de la ruta (misma precedencia que la ingesta inicial: frontmatter
    // primero, luego ruta). Estas pruebas documentan ese comportamiento tal
    // cual esta; no lo aprueban. Consecuencias: un archivo dentro de la carpeta
    // de una empresa cuyo frontmatter nombra a otra queda en la otra, y mover
    // el archivo de carpeta NO lo cambia de empresa mientras el frontmatter siga.
    it('[decision pendiente] con frontmatter empresa distinta de la ruta, manda el frontmatter', async () => {
      const markdown = markdownDe(
        'Conflicto',
        'turquesa',
        'empresa: Operativ AI'
      );
      const r = await e.ingerir({
        driveFileId: 'drive-conflicto',
        ruta: `${CLIENTE_B}/02_Proyecto/conflicto.md`,
        markdown
      });
      assert.equal(r.empresa, 'operativai');
      assert.equal(
        (await guardado('drive-conflicto')).doc?.['empresa'],
        'operativai'
      );
      // Esta en la carpeta de Dealer Solutions pero lo ve Operativ AI, no Dealer.
      assert.ok(
        documentos(await e.buscar('tok-operativ')).includes('drive-conflicto')
      );
      assert.ok(
        !documentos(await e.buscar('tok-dealer')).includes('drive-conflicto')
      );
    });

    it('[decision pendiente] mover un archivo con frontmatter de empresa no lo cambia de empresa', async () => {
      const markdown = markdownDe(
        'Fijo por frontmatter',
        'malaquita',
        'empresa: Operativ AI'
      );
      await e.ingerir({
        driveFileId: 'drive-fijo',
        ruta: `${CLIENTE_B}/02_Proyecto/fijo.md`,
        markdown
      });
      const r = await e.ingerir({
        driveFileId: 'drive-fijo',
        ruta: 'Empresas/Nexus Q Tech/Cliente E/Otro/02_Proyecto/fijo.md',
        markdown
      });
      assert.equal(r.omitido, true);
      const { doc, frags } = await guardado('drive-fijo');
      assert.equal(doc?.['empresa'], 'operativai');
      assert.ok(frags.every((f) => f['empresa'] === 'operativai'));
      // El cliente sale de la ruta (no hay `cliente:` en el frontmatter), asi
      // que ese si se realinea: empresa y cliente pueden quedar de lados distintos.
      assert.equal(doc?.['cliente'], 'Cliente E');
    });
  }
);
