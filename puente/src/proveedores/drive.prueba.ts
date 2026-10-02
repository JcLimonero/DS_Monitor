import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  ErrorBorradoNoPermitido,
  ErrorReconectarGoogle
} from '../nucleo/errores.js';
import { borrarTranscripcion, esSinPermisoDeBorrado } from './fireflies.js';
import {
  archivoDeDrive,
  carpetaDeDrive,
  documentoPorPropiedad,
  escaparConsultaDrive,
  subirComoDocumento
} from './google.js';

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

interface Llamado {
  url: string;
  metodo: string;
  cuerpo: string;
  tipo: string;
}

function simular(
  respuestas: (Response | ((l: Llamado) => Response))[]
): Llamado[] {
  const llamados: Llamado[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const l: Llamado = {
      url: String(url),
      metodo: init?.method ?? 'GET',
      cuerpo: typeof init?.body === 'string' ? init.body : '',
      tipo: String(
        (init?.headers as Record<string, string>)?.['content-type'] ?? ''
      )
    };
    llamados.push(l);
    const siguiente = respuestas.shift();
    if (!siguiente) {
      throw new Error('fetch inesperado');
    }
    return typeof siguiente === 'function' ? siguiente(l) : siguiente;
  }) as typeof fetch;
  return llamados;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('Drive', () => {
  it('escapa comillas y diagonales en las consultas', () => {
    assert.equal(escaparConsultaDrive("DS's \\ x"), "DS\\'s \\\\ x");
  });

  it('carpetaDeDrive reusa la que existe y crea la que falta', async () => {
    let llamados = simular([json({ files: [{ id: 'carp1' }] })]);
    assert.equal(
      await carpetaDeDrive('tok', 'DS Monitor · Transcripciones'),
      'carp1'
    );
    const q = new URL(llamados[0]?.url as string).searchParams.get('q');
    assert.match(q as string, /mimeType='application\/vnd.google-apps.folder'/);
    assert.match(q as string, /name='DS Monitor · Transcripciones'/);
    assert.match(q as string, /trashed=false/);

    llamados = simular([json({ files: [] }), json({ id: 'nueva' })]);
    assert.equal(await carpetaDeDrive('tok', 'Carpeta'), 'nueva');
    assert.equal(llamados[1]?.metodo, 'POST');
    assert.deepEqual(JSON.parse(llamados[1]?.cuerpo as string), {
      name: 'Carpeta',
      mimeType: 'application/vnd.google-apps.folder'
    });
  });

  it('subirComoDocumento manda multipart con mimeType de Doc, carpeta y propiedad', async () => {
    const llamados = simular([
      json({
        id: 'doc9',
        webViewLink: 'https://docs.google.com/document/d/doc9/edit'
      })
    ]);
    const r = await subirComoDocumento(
      'tok',
      'carp1',
      '2026-09-30 — Junta',
      'Hola mundo ñ',
      {
        firefliesId: 'ff1'
      }
    );
    assert.equal(r.id, 'doc9');
    const l = llamados[0] as Llamado;
    assert.match(l.url, /upload\/drive\/v3\/files\?.*uploadType=multipart/);
    assert.match(l.tipo, /^multipart\/related; boundary=/);
    const frontera = /boundary=(.+)$/.exec(l.tipo)?.[1] as string;
    const partes = l.cuerpo
      .split(`--${frontera}`)
      .filter((x) => x.trim() && x.trim() !== '--');
    assert.equal(partes.length, 2);
    const meta = JSON.parse(partes[0]?.split('\r\n\r\n')[1]?.trim() as string);
    assert.deepEqual(meta, {
      name: '2026-09-30 — Junta',
      mimeType: 'application/vnd.google-apps.document',
      parents: ['carp1'],
      appProperties: { firefliesId: 'ff1' }
    });
    assert.ok(partes[1]?.includes('text/plain; charset=UTF-8'));
    assert.ok(partes[1]?.includes('Hola mundo ñ'));
  });

  it('un 403 por permisos pide reconectar Google; otros errores no', async () => {
    simular([
      json(
        {
          error: {
            message: 'Request had insufficient authentication scopes.',
            errors: [{ reason: 'insufficientPermissions' }]
          }
        },
        403
      )
    ]);
    await assert.rejects(archivoDeDrive('tok', 'x'), ErrorReconectarGoogle);
    simular([json({ error: { message: 'boom' } }, 500)]);
    await assert.rejects(archivoDeDrive('tok', 'x'), /Drive respondió 500/);
  });

  it('documentoPorPropiedad busca por la propiedad dentro de la carpeta', async () => {
    const llamados = simular([json({ files: [{ id: 'd1' }] })]);
    const a = await documentoPorPropiedad('tok', 'carp1', 'firefliesId', 'ff1');
    assert.equal(a?.id, 'd1');
    const q = new URL(llamados[0]?.url as string).searchParams.get(
      'q'
    ) as string;
    assert.match(q, /'carp1' in parents/);
    assert.match(
      q,
      /appProperties has \{ key='firefliesId' and value='ff1' \}/
    );
  });
});

describe('borrarTranscripcion', () => {
  const config = { apiKey: 'k' };

  it('manda la mutation deleteTranscript con el id', async () => {
    const llamados = simular([
      json({ data: { deleteTranscript: { id: 'ff1' } } })
    ]);
    await borrarTranscripcion(config, 'ff1');
    const cuerpo = JSON.parse(llamados[0]?.cuerpo as string);
    assert.match(cuerpo.query, /deleteTranscript\(id: \$id\)/);
    assert.deepEqual(cuerpo.variables, { id: 'ff1' });
  });

  it('sin permiso lanza un error claro (no tumba el proceso)', async () => {
    simular([
      json(
        {
          errors: [
            {
              message: 'Only admins can delete',
              extensions: { code: 'require_elevated_privilege' }
            }
          ]
        },
        200
      )
    ]);
    await assert.rejects(borrarTranscripcion(config, 'ff1'), (e) => {
      assert.ok(e instanceof ErrorBorradoNoPermitido);
      assert.match((e as Error).message, /no permite borrar/);
      return true;
    });
  });

  it('una que ya no existe cuenta como borrada; un fallo de red no se confunde con permisos', async () => {
    simular([
      json({
        errors: [
          { message: 'not found', extensions: { code: 'object_not_found' } }
        ]
      })
    ]);
    await borrarTranscripcion(config, 'ff1');
    simular([json({ errors: [{ message: 'Internal error' }] }, 500)]);
    await assert.rejects(borrarTranscripcion(config, 'ff1'), (e) => {
      assert.ok(!(e instanceof ErrorBorradoNoPermitido));
      return true;
    });
    assert.equal(esSinPermisoDeBorrado(new Error('x')), false);
  });
});
