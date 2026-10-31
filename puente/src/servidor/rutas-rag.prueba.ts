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
import { RespuestaBinaria } from './router.js';
import {
  establecerGanchosRag,
  establecerGanchosDescarga
} from './rutas-rag.js';

class SqlFalsa implements Sql {
  consultas: { texto: string; parametros: unknown[] }[] = [];
  doc?: Fila;
  documentosDescarga: Record<
    string,
    { empresa: string; sensibilidad: string }
  > = {
    'drive-9': { empresa: 'dealer-solutions', sensibilidad: 'general' },
    'drive-itech': { empresa: 'itech-dev', sensibilidad: 'general' }
  };

  async ejecutar(texto: string, parametros: unknown[] = []): Promise<Fila[]> {
    this.consultas.push({ texto, parametros });
    if (texto.includes('FROM rag_documentos') && texto.includes('huella')) {
      return this.doc ? [this.doc] : [];
    }
    if (
      texto.includes('SELECT empresa') &&
      texto.includes('sensibilidad') &&
      texto.includes('drive_file_id')
    ) {
      const driveFileId = parametros[0] as string;
      const info = this.documentosDescarga[driveFileId];
      return info
        ? [{ empresa: info.empresa, sensibilidad: info.sensibilidad }]
        : [];
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
          titulo: 'Revision',
          drive_file_id: 'drive-9',
          drive_url: 'https://drive.google.com/file/d/drive-9/view'
        }
      ];
    }
    if (
      texto.includes('DISTINCT empresa, proyecto') &&
      texto.includes('FROM rag_documentos')
    ) {
      const empresas = (parametros[0] as string[]) ?? [];
      const proyectos: Fila[] = [];
      if (empresas.includes('dealer-solutions')) {
        proyectos.push({ empresa: 'dealer-solutions', proyecto: 'Portal' });
        proyectos.push({
          empresa: 'dealer-solutions',
          proyecto: 'Facturacion'
        });
      }
      if (empresas.includes('itech-dev')) {
        proyectos.push({ empresa: 'itech-dev', proyecto: 'Interno' });
      }
      return proyectos;
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
  establecerGanchosDescarga({});
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
  opciones?: { alcance?: UsuarioCrm['alcance']; roles?: string[] }
): Promise<void> {
  const { alcance, roles = ['comercial'] } = opciones ?? {};
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
      await sembrarUsuario(datos, 'alcance@ejemplo.test', { alcance });
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
      alcance: { empresas: ['dealer-solutions'] }
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

  it('buscar con filtro de proyecto incluye el proyecto en la consulta', async () => {
    const { router, sql } = await montar();
    redFalsa();
    sql.consultas.length = 0;
    await router.resolver(
      '/rag/buscar',
      new URLSearchParams(),
      'POST',
      { pregunta: 'que se dijo del portal', proyecto: 'Portal' },
      { authorization: 'Bearer admin-prueba' }
    );
    const selects = sql.consultas.filter((c) =>
      c.texto.includes('FROM rag_fragmentos')
    );
    assert.ok(selects.length >= 1);
    for (const consulta of selects) {
      assert.match(consulta.texto, /d\.proyecto/i);
      assert.ok(
        consulta.parametros.includes('Portal'),
        'el proyecto debe estar en los parametros'
      );
    }
  });
});

describe('GET /rag/alcance', () => {
  it('devuelve las empresas permitidas para el admin', async () => {
    const { router } = await montar();
    const alcance = (await router.resolver(
      '/rag/alcance',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer admin-prueba' }
    )) as {
      empresas: { id: string; nombre: string; proyectos: string[] }[];
      puedeItech: boolean;
    };
    assert.ok(alcance.empresas.length > 0);
    assert.equal(alcance.puedeItech, true);
    for (const emp of alcance.empresas) {
      assert.ok(emp.id);
      assert.ok(emp.nombre);
      assert.ok(Array.isArray(emp.proyectos));
    }
  });

  it('un emisor de dealer solo ve dealer-solutions', async () => {
    const { router } = await montar();
    const alcance = (await router.resolver(
      '/rag/alcance',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-dealer' }
    )) as { empresas: { id: string }[]; puedeItech: boolean };
    assert.equal(alcance.empresas.length, 1);
    assert.equal(alcance.empresas[0]?.id, 'dealer-solutions');
    assert.equal(alcance.puedeItech, false);
  });

  it('un emisor de itech solo ve itech-dev y puedeItech es true', async () => {
    const { router } = await montar();
    const alcance = (await router.resolver(
      '/rag/alcance',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-itech' }
    )) as { empresas: { id: string }[]; puedeItech: boolean };
    assert.equal(alcance.empresas.length, 1);
    assert.equal(alcance.empresas[0]?.id, 'itech-dev');
    assert.equal(alcance.puedeItech, true);
  });

  it('sin autenticacion devuelve 401', async () => {
    const { router } = await montar();
    await assert.rejects(
      () => router.resolver('/rag/alcance', new URLSearchParams(), 'GET'),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 401
    );
  });
});

describe('descarga de archivos RAG', () => {
  function descargaFalsa(): void {
    establecerGanchosDescarga({
      tokenDeCuentaServicio: async () => 'token-servicio-falso',
      descargarArchivo: async (_token, driveFileId) => ({
        contenido: Buffer.from(`contenido de ${driveFileId}`),
        mimeType: 'text/markdown',
        nombre: `${driveFileId}.md`
      })
    });
  }

  it('sin sesion ni token, la descarga pide autenticacion', async () => {
    const { router } = await montar();
    descargaFalsa();
    await assert.rejects(
      () =>
        router.resolver(
          '/rag/archivo/drive-9',
          new URLSearchParams(),
          'GET',
          undefined,
          {}
        ),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 401
    );
  });

  it('documento no encontrado devuelve 404', async () => {
    const { router } = await montar();
    descargaFalsa();
    await assert.rejects(
      () =>
        router.resolver(
          '/rag/archivo/drive-no-existe',
          new URLSearchParams(),
          'GET',
          undefined,
          { authorization: 'Bearer admin-prueba' }
        ),
      (error: unknown) =>
        error instanceof ErrorPuente &&
        error.estado === 404 &&
        /no encontrado/i.test(error.message)
    );
  });

  it('un emisor de dealer no puede descargar documentos de itech (retorna 404 uniforme)', async () => {
    const { router, sql } = await montar();
    descargaFalsa();
    sql.documentosDescarga['drive-itech'] = {
      empresa: 'itech-dev',
      sensibilidad: 'general'
    };
    await assert.rejects(
      () =>
        router.resolver(
          '/rag/archivo/drive-itech',
          new URLSearchParams(),
          'GET',
          undefined,
          { authorization: 'Bearer tok-dealer' }
        ),
      (error: unknown) =>
        error instanceof ErrorPuente &&
        error.estado === 404 &&
        /no encontrado/i.test(error.message)
    );
  });

  it('un emisor de dealer puede descargar documentos de dealer', async () => {
    const { router } = await montar();
    descargaFalsa();
    const respuesta = await router.resolver(
      '/rag/archivo/drive-9',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-dealer' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
    assert.equal(respuesta.mimeType, 'text/markdown');
    assert.equal(respuesta.nombreArchivo, 'drive-9.md');
    assert.equal(respuesta.contenido.toString(), 'contenido de drive-9');
  });

  it('el admin puede descargar cualquier documento', async () => {
    const { router, sql } = await montar();
    descargaFalsa();
    sql.documentosDescarga['drive-itech'] = {
      empresa: 'itech-dev',
      sensibilidad: 'general'
    };
    const respuesta = await router.resolver(
      '/rag/archivo/drive-itech',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer admin-prueba' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
    assert.equal(respuesta.contenido.toString(), 'contenido de drive-itech');
  });

  it('un usuario con sesion y alcance de empresas solo descarga de sus empresas', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'dealer@ejemplo.test', {
      alcance: { empresas: ['dealer-solutions'] }
    });
    await sembrarSesion(datos, 'tok-empresa-dealer', 'dealer@ejemplo.test');
    descargaFalsa();
    sql.documentosDescarga['drive-itech'] = {
      empresa: 'itech-dev',
      sensibilidad: 'general'
    };

    const ok = await router.resolver(
      '/rag/archivo/drive-9',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-empresa-dealer' }
    );
    assert.ok(ok instanceof RespuestaBinaria);

    await assert.rejects(
      () =>
        router.resolver(
          '/rag/archivo/drive-itech',
          new URLSearchParams(),
          'GET',
          undefined,
          { authorization: 'Bearer tok-empresa-dealer' }
        ),
      (error: unknown) =>
        error instanceof ErrorPuente &&
        error.estado === 404 &&
        /no encontrado/i.test(error.message)
    );
  });

  it('el director por sesion puede descargar de cualquier empresa', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarSesion(datos, 'tok-director', 'ana@ejemplo.test');
    descargaFalsa();
    sql.documentosDescarga['drive-itech'] = {
      empresa: 'itech-dev',
      sensibilidad: 'general'
    };

    const respuesta = await router.resolver(
      '/rag/archivo/drive-itech',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-director' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
    assert.equal(respuesta.contenido.toString(), 'contenido de drive-itech');
  });

  it('la respuesta de descarga nunca contiene URLs de Drive en metadatos', async () => {
    const { router } = await montar();
    establecerGanchosDescarga({
      tokenDeCuentaServicio: async () => 'token-servicio-falso',
      descargarArchivo: async () => ({
        contenido: Buffer.from('contenido seguro'),
        mimeType: 'application/pdf',
        nombre: 'documento.pdf'
      })
    });
    const respuesta = await router.resolver(
      '/rag/archivo/drive-9',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer admin-prueba' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
    const texto = JSON.stringify({
      mimeType: respuesta.mimeType,
      nombre: respuesta.nombreArchivo,
      contenido: respuesta.contenido.toString()
    });
    assert.doesNotMatch(texto, /drive\.google\.com/);
    assert.doesNotMatch(texto, /driveFileId/);
    assert.doesNotMatch(texto, /drive-9/);
  });

  it('documentos con sensibilidad costos retornan 404 para usuarios sin permiso', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'comercial@ejemplo.test', {
      roles: ['comercial']
    });
    await sembrarSesion(datos, 'tok-comercial', 'comercial@ejemplo.test');
    descargaFalsa();
    sql.documentosDescarga['drive-costos'] = {
      empresa: 'dealer-solutions',
      sensibilidad: 'costos'
    };

    await assert.rejects(
      () =>
        router.resolver(
          '/rag/archivo/drive-costos',
          new URLSearchParams(),
          'GET',
          undefined,
          { authorization: 'Bearer tok-comercial' }
        ),
      (error: unknown) =>
        error instanceof ErrorPuente &&
        error.estado === 404 &&
        /no encontrado/i.test(error.message)
    );
  });

  it('documentos con sensibilidad costos son accesibles para usuarios con permiso', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'finanzas@ejemplo.test', {
      roles: ['finanzas']
    });
    await sembrarSesion(datos, 'tok-finanzas', 'finanzas@ejemplo.test');
    descargaFalsa();
    sql.documentosDescarga['drive-costos'] = {
      empresa: 'dealer-solutions',
      sensibilidad: 'costos'
    };

    const respuesta = await router.resolver(
      '/rag/archivo/drive-costos',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-finanzas' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
  });

  it('documentos con sensibilidad general son accesibles para todos', async () => {
    const { router, sql, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'comercial@ejemplo.test', {
      roles: ['comercial']
    });
    await sembrarSesion(datos, 'tok-comercial', 'comercial@ejemplo.test');
    descargaFalsa();
    sql.documentosDescarga['drive-general'] = {
      empresa: 'dealer-solutions',
      sensibilidad: 'general'
    };

    const respuesta = await router.resolver(
      '/rag/archivo/drive-general',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-comercial' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
  });

  it('el admin puede descargar documentos con costos', async () => {
    const { router, sql } = await montar();
    descargaFalsa();
    sql.documentosDescarga['drive-costos'] = {
      empresa: 'dealer-solutions',
      sensibilidad: 'costos'
    };

    const respuesta = await router.resolver(
      '/rag/archivo/drive-costos',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer admin-prueba' }
    );
    assert.ok(respuesta instanceof RespuestaBinaria);
  });
});

describe('GET /rag/atencion', () => {
  it('el admin ve todos los puntos de atencion', async () => {
    const { router, datos } = await montar();
    await datos.crmProyectos.escribir([
      {
        id: 'proy-1',
        nombre: 'Portal',
        clienteId: 'cliente-1',
        empresaAtiendeId: 'dealer-solutions',
        actualizadoEn: '2026-10-01T00:00:00.000Z'
      }
    ]);
    await datos.crmRiesgos.escribir([
      {
        id: 'riesgo-1',
        proyectoId: 'proy-1',
        tipo: 'riesgo',
        descripcion: 'Costo de $5,000 MXN pendiente',
        impacto: 'Alto impacto: $10,000 USD',
        mitigacion: 'Pagar con cuenta 12345678901234',
        fechaReporte: '2026-10-15',
        abierto: true,
        actualizadoEn: '2026-10-15T00:00:00.000Z'
      }
    ]);
    const resultado = (await router.resolver(
      '/rag/atencion',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer admin-prueba' }
    )) as {
      puntos: { id: string; descripcion: string; mitigacion: string | null }[];
      puedeCostos: boolean;
    };
    assert.equal(resultado.puedeCostos, true);
    assert.ok(resultado.puntos.length >= 1);
    const riesgo = resultado.puntos.find((p) => p.id === 'riesgo-1');
    assert.ok(riesgo);
    assert.match(riesgo.descripcion, /\$5,000/);
    assert.match(riesgo.mitigacion ?? '', /12345678901234/);
  });

  it('un usuario sin permiso de costos ve los campos redactados', async () => {
    const { router, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'comercial@ejemplo.test', {
      roles: ['comercial']
    });
    await sembrarSesion(datos, 'tok-comercial', 'comercial@ejemplo.test');
    await datos.crmProyectos.escribir([
      {
        id: 'proy-1',
        nombre: 'Portal',
        clienteId: 'cliente-1',
        empresaAtiendeId: 'dealer-solutions',
        actualizadoEn: '2026-10-01T00:00:00.000Z'
      }
    ]);
    await datos.crmRiesgos.escribir([
      {
        id: 'riesgo-1',
        proyectoId: 'proy-1',
        tipo: 'riesgo',
        descripcion: 'Costo de $5,000 MXN pendiente',
        impacto: 'Alto impacto: $10,000 USD',
        mitigacion: 'Pagar con cuenta 12345678901234',
        fechaReporte: '2026-10-15',
        abierto: true,
        actualizadoEn: '2026-10-15T00:00:00.000Z'
      }
    ]);
    const resultado = (await router.resolver(
      '/rag/atencion',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-comercial' }
    )) as {
      puntos: {
        id: string;
        descripcion: string;
        impacto: string | null;
        mitigacion: string | null;
      }[];
      puedeCostos: boolean;
    };
    assert.equal(resultado.puedeCostos, false);
    const riesgo = resultado.puntos.find((p) => p.id === 'riesgo-1');
    assert.ok(riesgo);
    assert.match(riesgo.descripcion, /\[monto redactado\]/);
    assert.match(riesgo.impacto ?? '', /\[monto redactado\]/);
    assert.match(riesgo.mitigacion ?? '', /\[cuenta redactada\]/);
    assert.doesNotMatch(riesgo.descripcion, /\$5,000/);
    assert.doesNotMatch(riesgo.mitigacion ?? '', /12345678901234/);
  });

  it('un usuario con alcance solo ve items de sus empresas permitidas', async () => {
    const { router, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'dealer@ejemplo.test', {
      alcance: { empresas: ['dealer-solutions'] }
    });
    await sembrarSesion(datos, 'tok-dealer', 'dealer@ejemplo.test');
    await datos.crmProyectos.escribir([
      {
        id: 'proy-dealer',
        nombre: 'Portal Dealer',
        clienteId: 'cliente-1',
        empresaAtiendeId: 'dealer-solutions',
        actualizadoEn: '2026-10-01T00:00:00.000Z'
      },
      {
        id: 'proy-itech',
        nombre: 'Portal Itech',
        clienteId: 'cliente-2',
        empresaAtiendeId: 'itech-dev',
        actualizadoEn: '2026-10-01T00:00:00.000Z'
      }
    ]);
    await datos.crmRiesgos.escribir([
      {
        id: 'riesgo-dealer',
        proyectoId: 'proy-dealer',
        tipo: 'riesgo',
        descripcion: 'Riesgo de Dealer',
        fechaReporte: '2026-10-15',
        abierto: true,
        actualizadoEn: '2026-10-15T00:00:00.000Z'
      },
      {
        id: 'riesgo-itech',
        proyectoId: 'proy-itech',
        tipo: 'riesgo',
        descripcion: 'Riesgo de Itech',
        fechaReporte: '2026-10-15',
        abierto: true,
        actualizadoEn: '2026-10-15T00:00:00.000Z'
      }
    ]);
    const resultado = (await router.resolver(
      '/rag/atencion',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-dealer' }
    )) as { puntos: { id: string }[] };
    const ids = resultado.puntos.map((p) => p.id);
    assert.ok(ids.includes('riesgo-dealer'));
    assert.ok(!ids.includes('riesgo-itech'));
  });

  it('riesgos de proyectos sin empresa se ocultan para usuarios con tope', async () => {
    const { router, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarUsuario(datos, 'dealer@ejemplo.test', {
      alcance: { empresas: ['dealer-solutions'] }
    });
    await sembrarSesion(datos, 'tok-dealer', 'dealer@ejemplo.test');
    await datos.crmProyectos.escribir([
      {
        id: 'proy-sin-empresa',
        nombre: 'Proyecto Sin Empresa',
        clienteId: 'cliente-1',
        actualizadoEn: '2026-10-01T00:00:00.000Z'
      }
    ]);
    await datos.crmRiesgos.escribir([
      {
        id: 'riesgo-sin-empresa',
        proyectoId: 'proy-sin-empresa',
        tipo: 'riesgo',
        descripcion: 'Riesgo sin empresa asignada',
        fechaReporte: '2026-10-15',
        abierto: true,
        actualizadoEn: '2026-10-15T00:00:00.000Z'
      }
    ]);
    const resultado = (await router.resolver(
      '/rag/atencion',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-dealer' }
    )) as { puntos: { id: string }[] };
    const ids = resultado.puntos.map((p) => p.id);
    assert.ok(
      !ids.includes('riesgo-sin-empresa'),
      'Items sin empresa deben ocultarse para usuarios con tope'
    );
  });

  it('el director ve items sin empresa', async () => {
    const { router, datos } = await montar(ACCESO_PRENDIDO);
    await sembrarSesion(datos, 'tok-director', 'ana@ejemplo.test');
    await datos.crmProyectos.escribir([
      {
        id: 'proy-sin-empresa',
        nombre: 'Proyecto Sin Empresa',
        clienteId: 'cliente-1',
        actualizadoEn: '2026-10-01T00:00:00.000Z'
      }
    ]);
    await datos.crmRiesgos.escribir([
      {
        id: 'riesgo-sin-empresa',
        proyectoId: 'proy-sin-empresa',
        tipo: 'riesgo',
        descripcion: 'Riesgo sin empresa asignada',
        fechaReporte: '2026-10-15',
        abierto: true,
        actualizadoEn: '2026-10-15T00:00:00.000Z'
      }
    ]);
    const resultado = (await router.resolver(
      '/rag/atencion',
      new URLSearchParams(),
      'GET',
      undefined,
      { authorization: 'Bearer tok-director' }
    )) as { puntos: { id: string }[] };
    const ids = resultado.puntos.map((p) => p.id);
    assert.ok(
      ids.includes('riesgo-sin-empresa'),
      'El director debe ver items sin empresa'
    );
  });

  it('sin autenticacion devuelve 401', async () => {
    const { router } = await montar();
    await assert.rejects(
      () => router.resolver('/rag/atencion', new URLSearchParams(), 'GET'),
      (error: unknown) => error instanceof ErrorPuente && error.estado === 401
    );
  });
});
