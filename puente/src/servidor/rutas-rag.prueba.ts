import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { leerConfiguracion } from '../config/entorno.js';
import {
  PersistenciaArchivos,
  type Fila,
  type Sql
} from '../datos/persistencia.js';
import { DIM_EMBEDDING } from '../proveedores/embeddings.js';
import type { UsuarioCrm } from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import {
  abrirDatos,
  cargarDatos,
  construirRutas,
  type Datos
} from './rutas.js';
import { establecerGanchosRag } from './rutas-rag.js';

class SqlFalsa implements Sql {
  consultas: { texto: string; parametros: unknown[] }[] = [];
  doc?: Fila;

  async ejecutar(texto: string, parametros: unknown[] = []): Promise<Fila[]> {
    this.consultas.push({ texto, parametros });
    if (texto.includes('FROM rag_documentos') && texto.includes('huella')) {
      return this.doc ? [this.doc] : [];
    }
    if (texto.includes('INSERT INTO rag_documentos')) {
      this.doc = {
        id: parametros[0],
        drive_file_id: parametros[1],
        huella: parametros[12],
        modelo_emb: parametros[13],
        ruta: parametros[3],
        drive_url: parametros[2],
        drive_modificado_en: parametros[14],
        proyecto: parametros[8],
        sensibilidad: parametros[15],
        fragmentos_desalineados: false
      };
      return [];
    }
    if (texto.includes('FROM rag_fragmentos')) {
      return [
        {
          id: '7',
          documento_id: 'ff-9',
          orden: 0,
          seccion: 'resumen',
          texto: 'Se hablo del portal.',
          empresa: 'dealer-solutions',
          cliente: 'Taller Norte',
          proyecto: 'Portal',
          fecha: '2026-10-12T18:00:00.000Z',
          sensibilidad: 'general',
          documento_sensibilidad: 'general',
          titulo: 'Revision',
          drive_file_id: 'drive-9',
          drive_url: 'https://drive.google.com/file/d/drive-9/view'
        }
      ];
    }
    return [];
  }

  transaccion<T>(f: (ejecutar: Sql['ejecutar']) => Promise<T>): Promise<T> {
    return f((texto, parametros) => this.ejecutar(texto, parametros));
  }
}

class PersistenciaConSql extends PersistenciaArchivos {
  readonly sql: Sql;
  constructor(dirs: Record<string, string>, sql: Sql) {
    super(dirs);
    this.sql = sql;
  }
}

const dirs: string[] = [];
after(async () => {
  establecerGanchosRag({});
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

const MARKDOWN = `---
id: ff-1
fecha: 2026-10-06
participantes: Ana
cliente: TPI Composites
proyecto: Facturacion
empresa: Itech Dev
---

# Facturacion

## Resumen

Se reviso el timbrado.

## Acuerdos

- Emitir el viernes.

## Transcripción

**Ana:** Vemos las facturas.
`;

async function montar(extra: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'puente-rag-'));
  dirs.push(dir);
  const sql = new SqlFalsa();
  const persistencia = new PersistenciaConSql(
    {
      datos: join(dir, 'datos'),
      ingesta: join(dir, 'ingesta'),
      correo: join(dir, 'correo'),
      integraciones: join(dir, 'integraciones')
    },
    sql
  );
  const config = leerConfiguracion({
    PUENTE_ADMIN_TOKEN: 'admin-prueba',
    OPENROUTER_API_KEY: 'sk-test',
    INGESTA_CLIENTES:
      'fireflies|tok-rag|rag|ops|0;consulta|tok-dealer|rag-consulta|ops|0|dealer-solutions;itech|tok-itech|rag-consulta|itech|0|itech-dev',
    ...extra
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
  return { router, sql, datos };
}

const ACCESO_PRENDIDO = {
  ACCESO_CORREOS: 'ana@ejemplo.test',
  EMAILJS_SERVICE_ID: 's',
  EMAILJS_TEMPLATE_ID: 't',
  EMAILJS_PUBLIC_KEY: 'p',
  EMAILJS_PRIVATE_KEY: 'k'
};

/** Sustituye la red del RAG: un vector fijo y una respuesta fija. */
function redFalsa(): void {
  establecerGanchosRag({
    embeddings: async () => [Array.from({ length: DIM_EMBEDDING }, () => 0.2)],
    redactar: async () => 'Respuesta de prueba.'
  });
}

async function sembrarSesion(
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

async function sembrarUsuario(
  datos: Datos,
  correo: string,
  alcance?: UsuarioCrm['alcance'],
  roles: string[] = ['comercial']
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
}

describe('rutas del RAG vectorial', () => {
  it('la ingesta exige token y omite un markdown que no cambio', async () => {
    const { router, sql } = await montar();
    let embeddings = 0;
    establecerGanchosRag({
      embeddings: async (_config, textos) => {
        embeddings += 1;
        return textos.map(() => Array.from({ length: DIM_EMBEDDING }, () => 0));
      }
    });
    await assert.rejects(
      () =>
        router.resolver('/ingesta/rag', new URLSearchParams(), 'POST', {
          driveFileId: 'drive-1',
          markdown: MARKDOWN
        }),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 401
    );
    sql.consultas.length = 0;
    const primero = (await router.resolver(
      '/ingesta/rag',
      new URLSearchParams(),
      'POST',
      {
        driveFileId: 'drive-1',
        driveUrl: 'https://drive.google.com/file/d/drive-1/view',
        ruta: 'Empresas/Itech Dev/TPI/02_Proyecto/Juntas/a.md',
        markdown: MARKDOWN
      },
      { authorization: 'Bearer tok-rag' }
    )) as { omitido: boolean; empresa: string; fragmentos: number };
    assert.equal(primero.omitido, false);
    assert.equal(primero.empresa, 'itech-dev');
    assert.ok(primero.fragmentos >= 3);
    const segundo = (await router.resolver(
      '/ingesta/rag',
      new URLSearchParams(),
      'POST',
      {
        driveFileId: 'drive-1',
        markdown: MARKDOWN,
        ruta: 'Empresas/Itech Dev/TPI/02_Proyecto/Juntas/a.md'
      },
      { authorization: 'Bearer tok-rag' }
    )) as { omitido: boolean };
    assert.equal(segundo.omitido, true);
    assert.equal(embeddings, 1);
    const textos = sql.consultas.map((c) => c.texto).join('\n');
    assert.doesNotMatch(textos, /crm_/);
  });

  it('buscar sin empresa excluye Itech y un token de dealer no puede pedirla', async () => {
    const { router, sql } = await montar();
    establecerGanchosRag({
      embeddings: async () => [
        Array.from({ length: DIM_EMBEDDING }, () => 0.2)
      ],
      redactar: async () => 'El timbrado queda para el viernes.'
    });
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal' },
      { authorization: 'Bearer admin-prueba' }
    )) as { fragmentos: { driveUrl: string; empresa: string }[] };
    assert.equal(
      busqueda.fragmentos[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 2);
    for (const consulta of selects) {
      assert.match(consulta.texto, /f\.empresa <> 'itech-dev'/);
    }
    await assert.rejects(
      () =>
        router.resolver(
          '/rag/buscar',
          new URLSearchParams(),
          'POST',
          { pregunta: 'facturas', empresa: 'itech-dev' },
          { authorization: 'Bearer tok-dealer' }
        ),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 403
    );
  });

  it('el token de Itech solo consulta Itech y preguntar cita la liga', async () => {
    const { router, sql } = await montar();
    establecerGanchosRag({
      embeddings: async () => [Array.from({ length: DIM_EMBEDDING }, () => 0)],
      redactar: async () => 'Sin liga en el texto.'
    });
    const respuesta = (await router.resolver(
      '/rag/preguntar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que paso con el timbrado' },
      { authorization: 'Bearer tok-itech' }
    )) as { respuesta: string; fuentes: { driveUrl: string }[] };
    assert.match(respuesta.respuesta, /drive-9/);
    assert.equal(
      respuesta.fuentes[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    for (const consulta of selects) {
      assert.doesNotMatch(consulta.texto, /<> 'itech-dev'/);
      assert.ok((consulta.parametros[0] as string[]).includes('itech-dev'));
    }
  });

  it('con acceso prendido, buscar sin sesion ni token de consulta pide entrar', async () => {
    const { router } = await montar({
      ACCESO_CORREOS: 'ana@ejemplo.test',
      EMAILJS_SERVICE_ID: 's',
      EMAILJS_TEMPLATE_ID: 't',
      EMAILJS_PUBLIC_KEY: 'p',
      EMAILJS_PRIVATE_KEY: 'k'
    });
    await assert.rejects(
      () =>
        router.resolver('/rag/buscar', new URLSearchParams(), 'POST', {
          pregunta: 'hola'
        }),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 401
    );
  });

  const sinEmpresas: [string, UsuarioCrm['alcance']][] = [
    ['proyectos', { proyectos: ['proyecto-1'] }],
    ['clientes', { clientes: ['cliente-1'] }]
  ];
  for (const [campo, alcance] of sinEmpresas) {
    it(`un alcance solo de ${campo} no abre el RAG: 403 y ninguna consulta de fragmentos`, async () => {
      const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
      await sembrarUsuario(datos, 'alcance@ejemplo.test', alcance);
      await sembrarSesion(datos, 'tok-sin-empresas', 'alcance@ejemplo.test');
      redFalsa();
      sql.consultas.length = 0;
      for (const ruta of ['/rag/buscar', '/rag/preguntar']) {
        await assert.rejects(
          () =>
            router.resolver(
              ruta,
              new URLSearchParams(),
              'POST',
              { pregunta: 'que se dijo del portal' },
              { authorization: 'Bearer tok-sin-empresas' }
            ),
          (error: unknown) =>
            error instanceof ErrorPuente &&
            error.estado === 403 &&
            /no incluye empresas/.test(error.message)
        );
      }
      assert.equal(
        sql.consultas.filter((c) => c.texto.includes('FROM rag_fragmentos'))
          .length,
        0
      );
    });
  }

  it('un alcance de empresas consulta solo esas, sin Itech', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'dealer@ejemplo.test', {
      empresas: ['dealer-solutions']
    });
    await sembrarSesion(datos, 'tok-empresa-dealer', 'dealer@ejemplo.test');
    redFalsa();
    sql.consultas.length = 0;
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal' },
      { authorization: 'Bearer tok-empresa-dealer' }
    )) as { fragmentos: { driveUrl: string }[] };
    assert.equal(
      busqueda.fragmentos[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 2);
    for (const consulta of selects) {
      assert.deepEqual(consulta.parametros[0], ['dealer-solutions']);
      assert.match(consulta.texto, /f\.empresa <> 'itech-dev'/);
    }
  });

  it('con el acceso apagado, sin sesion ni token no se consulta el RAG', async () => {
    const { router, sql } = await montar();
    redFalsa();
    sql.consultas.length = 0;
    await assert.rejects(
      () =>
        router.resolver('/rag/buscar', new URLSearchParams(), 'POST', {
          pregunta: 'que se dijo del portal'
        }),
      (error: unknown) =>
        error instanceof ErrorPuente &&
        error.estado === 401 &&
        error.message === 'Se requiere sesión para consultar el RAG.'
    );
    assert.equal(
      sql.consultas.filter((c) => c.texto.includes('FROM rag_fragmentos'))
        .length,
      0
    );
  });

  it('con el acceso apagado, el token de admin y el de consulta siguen entrando', async () => {
    const { router } = await montar();
    redFalsa();
    for (const authorization of ['Bearer admin-prueba', 'Bearer tok-dealer']) {
      const respuesta = (await router.resolver(
        '/rag/buscar',
        new URLSearchParams(),
        'POST',
        { pregunta: 'que se dijo del portal' },
        { authorization }
      )) as { fragmentos: unknown[] };
      assert.ok(respuesta.fragmentos.length > 0);
    }
  });

  it('el director por sesion no tiene tope y puede pedir Itech', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarSesion(datos, 'tok-director', 'ana@ejemplo.test');
    redFalsa();
    sql.consultas.length = 0;
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'facturas', empresa: 'itech-dev' },
      { authorization: 'Bearer tok-director' }
    )) as { fragmentos: unknown[] };
    assert.ok(busqueda.fragmentos.length > 0);
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 2);
    for (const consulta of selects) {
      assert.deepEqual(consulta.parametros[0], ['itech-dev']);
    }
  });

  it('un usuario sin alcance definido ve lo que su rol permite, como antes', async () => {
    const { router, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'libre@ejemplo.test');
    await sembrarSesion(datos, 'tok-libre', 'libre@ejemplo.test');
    redFalsa();
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal' },
      { authorization: 'Bearer tok-libre' }
    )) as { fragmentos: { driveUrl: string }[] };
    assert.equal(
      busqueda.fragmentos[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
  });

  it('un emisor de consulta cuya unica empresa esta mal escrita no abre el RAG: 403 y ninguna consulta de fragmentos', async () => {
    const { router, sql } = await montar({
      INGESTA_CLIENTES: 'errata|tok-errata|rag-consulta|ops|0|dealer-solucions'
    });
    redFalsa();
    sql.consultas.length = 0;
    for (const ruta of ['/rag/buscar', '/rag/preguntar']) {
      await assert.rejects(
        () =>
          router.resolver(
            ruta,
            new URLSearchParams(),
            'POST',
            { pregunta: 'que se dijo del portal' },
            { authorization: 'Bearer tok-errata' }
          ),
        (error: unknown) =>
          error instanceof ErrorPuente &&
          error.estado === 403 &&
          error.message ===
            'Las empresas de este token de consulta no son válidas.'
      );
    }
    assert.equal(
      sql.consultas.filter((c) => c.texto.includes('FROM rag_fragmentos'))
        .length,
      0
    );
  });

  it('un emisor de consulta con una empresa valida y otra mal escrita solo consulta la valida', async () => {
    const { router, sql } = await montar({
      INGESTA_CLIENTES:
        'mixto|tok-mixto|rag-consulta|ops|0|dealer-solucions,dealer-solutions'
    });
    redFalsa();
    sql.consultas.length = 0;
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal' },
      { authorization: 'Bearer tok-mixto' }
    )) as { fragmentos: { driveUrl: string }[] };
    assert.equal(
      busqueda.fragmentos[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 2);
    for (const consulta of selects) {
      assert.deepEqual(consulta.parametros[0], ['dealer-solutions']);
    }
  });

  it('un emisor de consulta con empresas validas consulta solo esas, sin Itech', async () => {
    const { router, sql } = await montar({
      INGESTA_CLIENTES:
        'valido|tok-valido|rag-consulta|ops|0|dealer-solutions,nexusqtech'
    });
    redFalsa();
    sql.consultas.length = 0;
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal' },
      { authorization: 'Bearer tok-valido' }
    )) as { fragmentos: { driveUrl: string }[] };
    assert.equal(
      busqueda.fragmentos[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 2);
    for (const consulta of selects) {
      assert.deepEqual(consulta.parametros[0], [
        'dealer-solutions',
        'nexusqtech'
      ]);
      assert.match(consulta.texto, /f\.empresa <> 'itech-dev'/);
    }
  });

  describe('costos', () => {
    const LISTA_BLANCA =
      /f\.sensibilidad = 'general' AND d\.sensibilidad = 'general'/;

    /** Las consultas de fragmentos de la ultima llamada: siempre las dos ramas. */
    function selectsDe(sql: {
      consultas: { texto: string; parametros: unknown[] }[];
    }) {
      const selects = sql.consultas.filter((c) =>
        c.texto.includes('FROM rag_fragmentos')
      );
      assert.equal(selects.length, 2, 'faltó una de las dos ramas');
      return selects;
    }

    async function buscar(
      router: Awaited<ReturnType<typeof montar>>['router'],
      token: string,
      cuerpo: Record<string, unknown> = {}
    ) {
      return router.resolver(
        '/rag/buscar',
        new URLSearchParams(),
        'POST',
        { pregunta: 'que se dijo del portal', ...cuerpo },
        { authorization: `Bearer ${token}` }
      );
    }

    it('el token de admin y el director por sesion ven costos: el SQL no filtra sensibilidad', async () => {
      const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
      await sembrarSesion(datos, 'tok-director', 'ana@ejemplo.test');
      redFalsa();
      for (const token of ['admin-prueba', 'tok-director']) {
        sql.consultas.length = 0;
        await buscar(router, token);
        for (const consulta of selectsDe(sql)) {
          assert.doesNotMatch(consulta.texto, /sensibilidad = /, token);
        }
      }
    });

    it('un token de consulta no ve costos, con empresas o sin ellas', async () => {
      const { router, sql } = await montar();
      redFalsa();
      for (const token of ['tok-dealer', 'tok-itech']) {
        sql.consultas.length = 0;
        await buscar(router, token);
        for (const consulta of selectsDe(sql)) {
          assert.match(consulta.texto, LISTA_BLANCA, token);
        }
      }
      const libre = await montar({
        INGESTA_CLIENTES: 'libre|tok-libre-consulta|rag-consulta|ops|0'
      });
      redFalsa();
      libre.sql.consultas.length = 0;
      await buscar(libre.router, 'tok-libre-consulta');
      for (const consulta of selectsDe(libre.sql)) {
        assert.match(consulta.texto, LISTA_BLANCA);
      }
    });

    it('preguntar tambien filtra por sensibilidad para el token de consulta', async () => {
      const { router, sql } = await montar();
      redFalsa();
      sql.consultas.length = 0;
      await router.resolver(
        '/rag/preguntar',
        new URLSearchParams(),
        'POST',
        { pregunta: 'cuanto cuesta el portal' },
        { authorization: 'Bearer tok-dealer' }
      );
      for (const consulta of selectsDe(sql)) {
        assert.match(consulta.texto, LISTA_BLANCA);
      }
    });

    it('un usuario sin el area costos no ve costos aunque tenga cotizaciones, con o sin alcance', async () => {
      const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
      await sembrarUsuario(datos, 'comercial@ejemplo.test');
      await sembrarUsuario(
        datos,
        'comercial-dealer@ejemplo.test',
        { empresas: ['dealer-solutions'] },
        ['comercial']
      );
      await sembrarSesion(datos, 'tok-comercial', 'comercial@ejemplo.test');
      await sembrarSesion(
        datos,
        'tok-comercial-dealer',
        'comercial-dealer@ejemplo.test'
      );
      redFalsa();
      for (const token of ['tok-comercial', 'tok-comercial-dealer']) {
        sql.consultas.length = 0;
        await buscar(router, token);
        for (const consulta of selectsDe(sql)) {
          assert.match(consulta.texto, LISTA_BLANCA, token);
        }
      }
    });

    it('un usuario con el area costos en lectura la recupera, sin salirse de su alcance', async () => {
      const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
      await sembrarUsuario(datos, 'finanzas@ejemplo.test', undefined, [
        'finanzas'
      ]);
      await sembrarUsuario(
        datos,
        'finanzas-dealer@ejemplo.test',
        { empresas: ['dealer-solutions'] },
        ['finanzas']
      );
      await sembrarSesion(datos, 'tok-finanzas', 'finanzas@ejemplo.test');
      await sembrarSesion(
        datos,
        'tok-finanzas-dealer',
        'finanzas-dealer@ejemplo.test'
      );
      redFalsa();
      sql.consultas.length = 0;
      await buscar(router, 'tok-finanzas');
      for (const consulta of selectsDe(sql)) {
        assert.doesNotMatch(consulta.texto, /sensibilidad = /);
      }
      sql.consultas.length = 0;
      await buscar(router, 'tok-finanzas-dealer');
      for (const consulta of selectsDe(sql)) {
        assert.doesNotMatch(consulta.texto, /sensibilidad = /);
        assert.deepEqual(consulta.parametros[0], ['dealer-solutions']);
        assert.match(consulta.texto, /f\.empresa <> 'itech-dev'/);
      }
    });

    it('ningun campo de la peticion concede costos', async () => {
      const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
      await sembrarUsuario(datos, 'comercial@ejemplo.test');
      await sembrarSesion(datos, 'tok-comercial', 'comercial@ejemplo.test');
      redFalsa();
      const intentos = [
        { incluirCostos: true },
        { costos: true },
        { puedeCostos: true },
        { sensibilidad: 'costos' },
        { sensibilidad: ['general', 'costos'] },
        { permisos: { costos: 'lectura' } },
        { incluirItech: false, director: true }
      ];
      for (const token of ['tok-dealer', 'tok-comercial']) {
        for (const intento of intentos) {
          sql.consultas.length = 0;
          await buscar(router, token, intento);
          for (const consulta of selectsDe(sql)) {
            assert.match(
              consulta.texto,
              LISTA_BLANCA,
              `${token} ${JSON.stringify(intento)}`
            );
          }
        }
      }
    });
  });

  it('un emisor de consulta sin empresas sigue viendo todas menos Itech, como hoy', async () => {
    // Comportamiento vigente, por inventariar: sin empresas el emisor ve todas
    // menos Itech. Se cierra en un paso posterior, tras inventariar los emisores
    // en produccion.
    const { router, sql } = await montar({
      INGESTA_CLIENTES: 'libre|tok-libre-consulta|rag-consulta|ops|0'
    });
    redFalsa();
    sql.consultas.length = 0;
    const busqueda = (await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal' },
      { authorization: 'Bearer tok-libre-consulta' }
    )) as { fragmentos: { driveUrl: string }[] };
    assert.equal(
      busqueda.fragmentos[0]?.driveUrl,
      'https://drive.google.com/file/d/drive-9/view'
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 2);
    for (const consulta of selects) {
      assert.match(consulta.texto, /f\.empresa <> 'itech-dev'/);
      assert.doesNotMatch(JSON.stringify(consulta.parametros), /itech-dev/);
    }
  });
});
