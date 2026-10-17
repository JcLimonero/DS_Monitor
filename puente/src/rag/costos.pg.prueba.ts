import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it, mock } from 'node:test';
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
import {
  avisarSiFaltaBackfill,
  buscarHibrido,
  guardarDocumento,
  saltarSiNoCambio,
  type DocumentoAGuardar
} from './almacen-vectorial.js';
import { asegurarEsquemaRag } from './esquema.js';
import { estimarTokens } from './fragmentar.js';
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

    // --- Cabecera del texto de los fragmentos --------------------------------
    //
    // `texto` empieza con una linea `[Empresa / Cliente / Proyecto] Junta ...`.
    // Al realinear sin embeber se reescribe esa linea (y con ella el tsv), sin
    // tocar el cuerpo ni el embedding.

    async function fragmentosDe(driveFileId: string) {
      return e.esquema.filas(
        `SELECT f.id::text AS id, f.orden, f.texto, f.tokens, f.embedding::text AS emb
           FROM rag_fragmentos f JOIN rag_documentos d ON d.id = f.documento_id
          WHERE d.drive_file_id = $1 ORDER BY f.orden`,
        [driveFileId]
      );
    }

    const cuerpoDe = (texto: unknown) =>
      String(texto).slice(String(texto).indexOf('\n'));
    const cabeceraDe = (texto: unknown) =>
      String(texto).slice(0, String(texto).indexOf('\n'));

    async function coincidencias(consulta: string): Promise<number> {
      const filas = await e.esquema.filas(
        `SELECT count(*)::int AS n FROM rag_fragmentos
          WHERE tsv @@ websearch_to_tsquery('spanish', $1)`,
        [consulta]
      );
      return Number(filas[0]?.['n']);
    }

    it('al mover un archivo la cabecera del texto cambia, el cuerpo y el embedding no, y la busqueda por texto sigue al nombre nuevo', async () => {
      const markdown = markdownDe('Con cabecera', 'tungsteno');
      await e.ingerir({
        driveFileId: 'drive-cabecera',
        ruta: 'Empresas/Dealer Solutions/Grupo Cuarzo Boreal/Taller/02_Proyecto/c.md',
        markdown
      });
      const antes = await fragmentosDe('drive-cabecera');
      assert.ok(antes.length >= 2);
      for (const f of antes) {
        assert.match(cabeceraDe(f['texto']), /Cuarzo Boreal/);
      }
      assert.ok((await coincidencias('Cuarzo Boreal')) >= 2);
      assert.equal(await coincidencias('Ambar Austral'), 0);

      const pedidosAntes = e.embeddings();
      const r = await e.ingerir({
        driveFileId: 'drive-cabecera',
        ruta: 'Empresas/Operativ AI/Grupo Ambar Austral/Otro/02_Proyecto/c.md',
        markdown
      });
      assert.equal(r.omitido, true);
      assert.equal(e.embeddings(), pedidosAntes, 'volvio a pedir embeddings');

      const despues = await fragmentosDe('drive-cabecera');
      assert.deepEqual(
        despues.map((f) => f['id']),
        antes.map((f) => f['id']),
        'los fragmentos se borraron y se volvieron a insertar'
      );
      for (const [i, f] of despues.entries()) {
        const cabecera = cabeceraDe(f['texto']);
        assert.match(cabecera, /Grupo Ambar Austral/);
        assert.match(cabecera, /Otro/);
        assert.doesNotMatch(cabecera, /Cuarzo Boreal|Dealer Solutions/);
        assert.equal(cuerpoDe(f['texto']), cuerpoDe(antes[i]?.['texto']));
        assert.equal(f['emb'], antes[i]?.['emb'], 'cambio el embedding');
        assert.equal(f['tokens'], estimarTokens(String(f['texto'])));
      }
      // El tsv se regenero con el texto nuevo.
      assert.equal(await coincidencias('Cuarzo Boreal'), 0);
      assert.ok((await coincidencias('Ambar Austral')) >= 2);
      // Y lo que devuelve la busqueda ya no trae el nombre viejo.
      const hallados = (await e.buscar('tok-operativ')).filter(
        (h) => h.driveFileId === 'drive-cabecera'
      );
      assert.ok(hallados.length >= 2);
      for (const h of hallados) {
        assert.doesNotMatch(h.texto, /Cuarzo Boreal|Dealer Solutions/);
      }
    });

    it('renombrar un archivo sin cambiar su empresa, cliente ni proyecto no reescribe ningun fragmento', async () => {
      const markdown = markdownDe('Solo renombrado', 'tantalo');
      await e.ingerir({
        driveFileId: 'drive-renombrado',
        ruta: `${CLIENTE_B}/02_Proyecto/uno.md`,
        markdown
      });
      const xmin = async () =>
        (
          await e.esquema.filas(
            `SELECT f.xmin::text AS xmin FROM rag_fragmentos f
               JOIN rag_documentos d ON d.id = f.documento_id
              WHERE d.drive_file_id = 'drive-renombrado' ORDER BY f.orden`
          )
        ).map((f) => f['xmin']);
      const antes = await xmin();
      assert.ok(antes.length >= 2);
      const r = await e.ingerir({
        driveFileId: 'drive-renombrado',
        ruta: `${CLIENTE_B}/02_Proyecto/dos.md`,
        markdown
      });
      assert.equal(r.omitido, true);
      assert.equal(
        (await guardado('drive-renombrado')).doc?.['ruta'],
        `${CLIENTE_B}/02_Proyecto/dos.md`
      );
      assert.deepEqual(
        await xmin(),
        antes,
        'reescribio fragmentos sin necesidad'
      );
    });

    it('mover a otro cliente de la misma empresa tambien refresca la cabecera', async () => {
      const markdown = markdownDe('Cabecera de cliente', 'vanadio');
      await e.ingerir({
        driveFileId: 'drive-cabecera-cliente',
        ruta: 'Empresas/Dealer Solutions/Grupo Zafiro Viejo/Taller/02_Proyecto/c.md',
        markdown
      });
      await e.ingerir({
        driveFileId: 'drive-cabecera-cliente',
        ruta: 'Empresas/Dealer Solutions/Grupo Zafiro Nuevo/Taller/02_Proyecto/c.md',
        markdown
      });
      for (const f of await fragmentosDe('drive-cabecera-cliente')) {
        assert.match(cabeceraDe(f['texto']), /Grupo Zafiro Nuevo/);
        assert.doesNotMatch(cabeceraDe(f['texto']), /Zafiro Viejo/);
      }
    });

    it('una cabecera que ya quedo vieja se refresca al reenviar lo mismo, aunque la clase no cambie', async () => {
      const markdown = markdownDe('Cabecera atrasada', 'niobio');
      const ruta = `${CLIENTE_B}/02_Proyecto/atrasada.md`;
      await e.ingerir({ driveFileId: 'drive-atrasada', ruta, markdown });
      const buena = await fragmentosDe('drive-atrasada');
      // Lo que dejaria una realineacion hecha antes de que se refrescara el texto.
      await e.esquema.sql.ejecutar(
        `UPDATE rag_fragmentos
            SET texto = '[Empresa Vieja / Cliente Viejo] Junta' || substr(texto, strpos(texto, chr(10)))
          WHERE documento_id = (SELECT id FROM rag_documentos WHERE drive_file_id = 'drive-atrasada')`
      );
      assert.ok((await coincidencias('Cliente Viejo')) >= 2);
      const pedidosAntes = e.embeddings();
      const r = await e.ingerir({
        driveFileId: 'drive-atrasada',
        ruta,
        markdown
      });
      assert.equal(r.omitido, true);
      assert.equal(e.embeddings(), pedidosAntes);
      const despues = await fragmentosDe('drive-atrasada');
      assert.deepEqual(
        despues.map((f) => f['texto']),
        buena.map((f) => f['texto'])
      );
      assert.equal(await coincidencias('Cliente Viejo'), 0);
    });

    it('un fragmento cuyo cuerpo no coincide no se reescribe: su embedding ya no correspondería', async () => {
      const markdown = markdownDe('Cuerpo distinto', 'cromo');
      const ruta = `${CLIENTE_B}/02_Proyecto/cuerpo.md`;
      await e.ingerir({ driveFileId: 'drive-cuerpo', ruta, markdown });
      const buena = await fragmentosDe('drive-cuerpo');
      assert.ok(buena.length >= 2);
      await e.esquema.sql.ejecutar(
        `UPDATE rag_fragmentos
            SET texto = '[Vieja] Junta' || substr(texto, strpos(texto, chr(10)))
                        || CASE WHEN orden = 0 THEN ' cuerpo alterado' ELSE '' END
          WHERE documento_id = (SELECT id FROM rag_documentos WHERE drive_file_id = 'drive-cuerpo')`
      );
      await e.ingerir({ driveFileId: 'drive-cuerpo', ruta, markdown });
      const despues = await fragmentosDe('drive-cuerpo');
      // El de cuerpo alterado se queda tal cual; los demas recuperan su cabecera.
      assert.match(String(despues[0]?.['texto']), /^\[Vieja\] Junta/);
      assert.match(String(despues[0]?.['texto']), /cuerpo alterado$/);
      for (const [i, f] of despues.entries()) {
        if (i > 0) {
          assert.equal(f['texto'], buena[i]?.['texto']);
        }
      }
    });

    // Un documento sin fragmentos solo tiene su fila de documento: lo unico que
    // lo realinea es la comparacion de columnas del documento. Cada caso cambia
    // UNA sola cosa (empresa, cliente, proyecto o sensibilidad).
    const SIN_FRAGMENTOS: [string, string, Record<string, string>][] = [
      [
        'solo la empresa',
        'Empresas/Operativ AI/Cliente B/Taller/02_Proyecto/vacio.md',
        {
          empresa: 'operativai',
          cliente: 'Cliente B',
          proyecto: 'Taller',
          sensibilidad: 'general'
        }
      ],
      [
        'solo el cliente',
        'Empresas/Dealer Solutions/Cliente D/Taller/02_Proyecto/vacio.md',
        {
          empresa: 'dealer-solutions',
          cliente: 'Cliente D',
          proyecto: 'Taller',
          sensibilidad: 'general'
        }
      ],
      [
        'solo el proyecto',
        'Empresas/Dealer Solutions/Cliente B/Otro/02_Proyecto/vacio.md',
        {
          empresa: 'dealer-solutions',
          cliente: 'Cliente B',
          proyecto: 'Otro',
          sensibilidad: 'general'
        }
      ],
      [
        'solo la sensibilidad',
        'Empresas/Dealer Solutions/Cliente B/Taller/04_Costos/vacio.md',
        {
          empresa: 'dealer-solutions',
          cliente: 'Cliente B',
          proyecto: 'Taller',
          sensibilidad: 'costos'
        }
      ]
    ];
    for (const [cambia, ruta, esperado] of SIN_FRAGMENTOS) {
      it(`un documento sin fragmentos se realinea al mover el archivo: ${cambia}`, async () => {
        const driveFileId = `drive-vacio-${cambia.replace(/ /g, '-')}`;
        const markdown = '# Solo titulo\n';
        await e.ingerir({
          driveFileId,
          ruta: `${CLIENTE_B}/02_Proyecto/vacio.md`,
          markdown
        });
        const previo = await guardado(driveFileId);
        assert.equal(previo.doc?.['empresa'], 'dealer-solutions');
        assert.equal(previo.doc?.['cliente'], 'Cliente B');
        assert.equal(previo.doc?.['proyecto'], 'Taller');
        assert.equal(previo.doc?.['sensibilidad'], 'general');
        assert.equal(previo.frags.length, 0);
        const r = await e.ingerir({ driveFileId, ruta, markdown });
        assert.equal(r.omitido, true);
        const despues = await guardado(driveFileId);
        for (const [columna, valor] of Object.entries(esperado)) {
          assert.equal(despues.doc?.[columna], valor, columna);
        }
      });
    }

    // Dos ingestas del mismo archivo (misma huella) con rutas distintas, y una
    // termina entre la lectura y el candado de la otra. Lo que queda guardado
    // tiene que salir completo de UNA de las dos, no de una mezcla.
    describe('dos ingestas que se cruzan', () => {
      const documentoDe = (extra: Partial<DocumentoAGuardar>) =>
        ({
          id: 'drive-carrera',
          driveFileId: 'drive-carrera',
          driveUrl: 'https://drive.google.com/file/d/drive-carrera/view',
          ruta: `${CLIENTE_B}/04_Costos/a.md`,
          titulo: 'Carrera',
          empresa: 'dealer-solutions',
          cliente: 'Cliente B',
          proyecto: 'Taller',
          sensibilidad: 'costos',
          participantes: [],
          frontmatter: {},
          huella: 'H',
          modeloEmb: 'modelo',
          fragmentos: [0, 1, 2].map((orden) => ({
            orden,
            seccion: 'resumen',
            texto: `texto de la carrera ${orden}`,
            tokens: 3,
            embedding: vectorDeterminista(`carrera ${orden}`)
          })),
          ...extra
        }) satisfies DocumentoAGuardar;

      /** Corre `otra` completa justo antes de que `sql` tome el candado de fila. */
      const conOtraAntesDelCandado = (
        sql: Sql,
        otra: DocumentoAGuardar
      ): Sql => {
        let hecho = false;
        return {
          ejecutar: sql.ejecutar,
          transaccion: async (f) => {
            if (!hecho) {
              hecho = true;
              await saltarSiNoCambio(sql, otra);
            }
            return sql.transaccion(f);
          }
        };
      };

      async function estado() {
        const g = await guardado('drive-carrera');
        return { doc: g.doc, frags: g.frags };
      }

      it('la ruta, la clase y la empresa quedan de la misma ingesta (sensibilidad)', async () => {
        await guardarDocumento(e.esquema.sql, documentoDe({}));
        // Esta solo ve que la ruta cambia (sigue en costos); la otra la baja a general.
        const esta = documentoDe({ ruta: `${CLIENTE_B}/04_Costos/b.md` });
        const otra = documentoDe({
          ruta: `${CLIENTE_B}/02_Proyecto/b.md`,
          sensibilidad: 'general'
        });
        const r = await saltarSiNoCambio(
          conOtraAntesDelCandado(e.esquema.sql, otra),
          esta
        );
        assert.equal(r?.omitido, true);
        const { doc, frags } = await estado();
        assert.equal(doc?.['ruta'], `${CLIENTE_B}/04_Costos/b.md`);
        assert.equal(doc?.['sensibilidad'], 'costos');
        assert.ok(frags.every((f) => f['sensibilidad'] === 'costos'));
        // Y quien no tiene costos no lo ve.
        assert.ok(
          !documentos(await e.buscar('tok-dealer')).includes('drive-carrera')
        );
      });

      it('la ruta, la clase y la empresa quedan de la misma ingesta (empresa)', async () => {
        const base = documentoDe({
          ruta: `${CLIENTE_B}/02_Proyecto/a.md`,
          sensibilidad: 'general',
          huella: 'H2'
        });
        await guardarDocumento(e.esquema.sql, base);
        const esta = { ...base, ruta: `${CLIENTE_B}/02_Proyecto/b.md` };
        const otra = {
          ...base,
          ruta: 'Empresas/Operativ AI/Cliente C/Otro/02_Proyecto/a.md',
          empresa: 'operativai',
          cliente: 'Cliente C',
          proyecto: 'Otro'
        };
        const r = await saltarSiNoCambio(
          conOtraAntesDelCandado(e.esquema.sql, otra),
          esta
        );
        assert.equal(r?.omitido, true);
        const { doc, frags } = await estado();
        assert.equal(doc?.['ruta'], esta.ruta);
        assert.equal(doc?.['empresa'], 'dealer-solutions');
        assert.equal(doc?.['cliente'], 'Cliente B');
        assert.ok(frags.every((f) => f['empresa'] === 'dealer-solutions'));
        assert.ok(frags.every((f) => f['cliente'] === 'Cliente B'));
        assert.ok(
          !documentos(await e.buscar('tok-operativ')).includes('drive-carrera')
        );
      });
    });

    // --- Conflicto entre el frontmatter y la ruta de Drive -------------------
    //
    // Decision de Carlos (2026-10-17): para la EMPRESA manda la ruta de Drive.
    // Sin ruta, o con una ruta que no resuelve a una empresa, vale el
    // frontmatter. Cliente y proyecto siguen con el frontmatter primero.
    const RUTA_ITECH = 'Empresas/Itech Dev/Cliente I/Proyecto I/02_Proyecto';

    it('con frontmatter empresa distinta de la ruta, manda la ruta y se avisa sin volcar contenido', async () => {
      const markdown = markdownDe(
        'Conflicto',
        'turquesa',
        'empresa: Operativ AI'
      );
      const avisos = mock.method(console, 'warn', () => undefined);
      try {
        const r = await e.ingerir({
          driveFileId: 'drive-conflicto',
          ruta: `${CLIENTE_B}/02_Proyecto/conflicto.md`,
          markdown
        });
        assert.equal(r.empresa, 'dealer-solutions');
        const textos = avisos.mock.calls.map((c) => c.arguments.join(' '));
        assert.equal(textos.length, 1);
        assert.match(textos[0] ?? '', /"drive-conflicto"/);
        assert.match(textos[0] ?? '', /frontmatter nombra otra empresa/);
        assert.doesNotMatch(textos[0] ?? '', /turquesa|Operativ AI|Conflicto/);
      } finally {
        avisos.mock.restore();
      }
      const { doc, frags } = await guardado('drive-conflicto');
      assert.equal(doc?.['empresa'], 'dealer-solutions');
      assert.ok(frags.every((f) => f['empresa'] === 'dealer-solutions'));
      // Esta en la carpeta de Dealer Solutions: lo ve Dealer, no Operativ AI.
      assert.ok(
        documentos(await e.buscar('tok-dealer')).includes('drive-conflicto')
      );
      assert.ok(
        !documentos(await e.buscar('tok-operativ')).includes('drive-conflicto')
      );
      // Y la cabecera del texto indexado no lleva la empresa que se ignoro.
      const textos = await e.esquema.filas(
        `SELECT f.texto FROM rag_fragmentos f
           JOIN rag_documentos d ON d.id = f.documento_id
          WHERE d.drive_file_id = 'drive-conflicto'`
      );
      assert.ok(textos.length > 0);
      assert.ok(textos.every((t) => !/Operativ AI/.test(String(t['texto']))));
    });

    it('un archivo en la carpeta de Itech Dev con empresa: Dealer Solutions se indexa como Itech y sigue excluido de las busquedas normales', async () => {
      const markdown = markdownDe(
        'Falsa Dealer',
        'basalto',
        'empresa: Dealer Solutions'
      );
      const avisos = mock.method(console, 'warn', () => undefined);
      try {
        const r = await e.ingerir({
          driveFileId: 'drive-itech-falso',
          ruta: `${RUTA_ITECH}/falsa.md`,
          markdown
        });
        assert.equal(r.empresa, 'itech-dev');
      } finally {
        avisos.mock.restore();
      }
      assert.equal(
        (await guardado('drive-itech-falso')).doc?.['empresa'],
        'itech-dev'
      );
      // Ni el token de Dealer, ni el director, ni el de admin lo ven sin pedir Itech.
      for (const token of [
        'tok-dealer',
        'tok-libre',
        'admin-prueba',
        'tok-ana'
      ]) {
        assert.ok(
          !documentos(await e.buscar(token)).includes('drive-itech-falso'),
          token
        );
      }
      // Quien no tiene permiso de Itech no la obtiene aunque la pida.
      await assert.rejects(
        () => e.buscar('tok-dealer', { empresa: 'itech-dev' }),
        (error: unknown) => (error as { estado?: number }).estado === 403
      );
      // El director si, pidiendola de forma explicita.
      assert.deepEqual(
        documentos(await e.buscar('tok-ana', { empresa: 'itech-dev' })),
        ['drive-itech-falso']
      );
    });

    it('una carpeta de cliente con nombre de empresa no saca un archivo de Itech: sin empresa en la primera carpeta vale el frontmatter', async () => {
      const markdown = markdownDe(
        'Itech sin clasificar',
        'sodalita',
        'empresa: Itech Dev'
      );
      const rutas: [string, string][] = [
        ['drive-itech-pc', 'Empresas/_POR_CLASIFICAR/Operativ/nota.md'],
        [
          'drive-itech-hist',
          'Empresas/_Historico/Cliente X/Nexus/02_Proyecto/a.md'
        ],
        ['drive-itech-nuevo', 'Empresas/Grupo Nuevo/Dealer/02_Proyecto/a.md']
      ];
      for (const [driveFileId, ruta] of rutas) {
        const r = await e.ingerir({ driveFileId, ruta, markdown });
        assert.equal(r.empresa, 'itech-dev', ruta);
        for (const token of [
          'tok-dealer',
          'tok-operativ',
          'tok-libre',
          'admin-prueba'
        ]) {
          assert.ok(
            !documentos(await e.buscar(token)).includes(driveFileId),
            `${token} ${ruta}`
          );
        }
      }
    });

    it('y al reves: un archivo de Dealer con empresa: Itech Dev no entra a Itech', async () => {
      const markdown = markdownDe(
        'Falsa Itech',
        'obsidiana2',
        'empresa: Itech Dev'
      );
      const avisos = mock.method(console, 'warn', () => undefined);
      try {
        await e.ingerir({
          driveFileId: 'drive-dealer-falso',
          ruta: `${CLIENTE_B}/02_Proyecto/falsa.md`,
          markdown
        });
      } finally {
        avisos.mock.restore();
      }
      assert.equal(
        (await guardado('drive-dealer-falso')).doc?.['empresa'],
        'dealer-solutions'
      );
      assert.deepEqual(
        documentos(
          await e.buscar('tok-ana', { empresa: 'itech-dev' })
        ).includes('drive-dealer-falso'),
        false
      );
      assert.ok(
        documentos(await e.buscar('tok-dealer')).includes('drive-dealer-falso')
      );
    });

    it('un archivo con frontmatter de empresa que se mueve de carpeta se realinea a la empresa de la nueva ruta', async () => {
      const markdown = markdownDe(
        'Se mueve con frontmatter',
        'malaquita',
        'empresa: Operativ AI'
      );
      const avisos = mock.method(console, 'warn', () => undefined);
      try {
        await e.ingerir({
          driveFileId: 'drive-fijo',
          ruta: `${CLIENTE_B}/02_Proyecto/fijo.md`,
          markdown
        });
        assert.equal(
          (await guardado('drive-fijo')).doc?.['empresa'],
          'dealer-solutions'
        );
        const pedidosAntes = e.embeddings();
        const r = await e.ingerir({
          driveFileId: 'drive-fijo',
          ruta: 'Empresas/Nexus Q Tech/Cliente E/Otro/02_Proyecto/fijo.md',
          markdown
        });
        assert.equal(r.omitido, true);
        assert.equal(r.empresa, 'nexusqtech');
        assert.equal(e.embeddings(), pedidosAntes);
      } finally {
        avisos.mock.restore();
      }
      const { doc, frags } = await guardado('drive-fijo');
      assert.equal(doc?.['empresa'], 'nexusqtech');
      assert.equal(doc?.['cliente'], 'Cliente E');
      assert.ok(frags.every((f) => f['empresa'] === 'nexusqtech'));
      assert.ok(
        !documentos(await e.buscar('tok-dealer')).includes('drive-fijo')
      );
    });

    it('sin ruta vale el frontmatter, y con una ruta que no resuelve a una empresa tambien', async () => {
      const sinRuta = await e.ingerir({
        driveFileId: 'drive-sin-ruta',
        markdown: markdownDe('Sin ruta', 'cinabrio', 'empresa: Operativ AI')
      });
      assert.equal(sinRuta.empresa, 'operativai');
      const ruta = await e.ingerir({
        driveFileId: 'drive-ruta-ajena',
        ruta: 'Otros/Cliente Suelto/02_Proyecto/ajena.md',
        markdown: markdownDe('Ruta ajena', 'pirita', 'empresa: Nexus Q Tech')
      });
      assert.equal(ruta.empresa, 'nexusqtech');
    });

    it('cliente y proyecto siguen con el frontmatter primero', async () => {
      await e.ingerir({
        driveFileId: 'drive-cliente-frente',
        ruta: `${CLIENTE_B}/02_Proyecto/cf.md`,
        markdown: markdownDe(
          'Cliente del frente',
          'ocre',
          'cliente: Cliente Frente\nproyecto: Proyecto Frente'
        )
      });
      const { doc } = await guardado('drive-cliente-frente');
      assert.equal(doc?.['cliente'], 'Cliente Frente');
      assert.equal(doc?.['proyecto'], 'Proyecto Frente');
      assert.equal(doc?.['empresa'], 'dealer-solutions');
    });
  }
);
