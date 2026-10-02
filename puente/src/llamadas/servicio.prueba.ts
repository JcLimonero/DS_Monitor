import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LlamadaArchivada } from '../nucleo/contrato.js';
import {
  ErrorBorradoNoPermitido,
  ErrorProveedor,
  ErrorReconectarGoogle
} from '../nucleo/errores.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import {
  archivarLlamadas,
  verificacionDeDoc,
  type Puertos
} from './servicio.js';

const AHORA = new Date('2026-10-01T18:00:00Z');

function trans(id: string, parte: Partial<Transcripcion> = {}): Transcripcion {
  return {
    id,
    titulo: `Junta ${id}`,
    fecha: '2026-09-25T16:00:00Z',
    participantes: ['ana@dealer.mx'],
    url: `https://app.fireflies.ai/view/${id}`,
    resumen: 'Resumen',
    frases: [{ texto: 'Hola', hablante: 'Ana', inicioSeg: 1 }],
    ...parte
  };
}

interface Bitacora {
  llamadas: LlamadaArchivada[];
  eventos: string[];
  ligas: [string, string][];
}

/** Puertos en memoria que anotan en que orden pasa todo. */
function armar(
  remotas: Transcripcion[],
  opciones: {
    procesadas?: string[];
    borrar?: boolean;
    falla?: Partial<{
      subir: Error;
      verificar: Error;
      borrar: Error;
      carpeta: Error;
      procesar: Error;
    }>;
    existentes?: LlamadaArchivada[];
  } = {}
): { p: Puertos; b: Bitacora } {
  const b: Bitacora = {
    llamadas: opciones.existentes ?? [],
    eventos: [],
    ligas: []
  };
  const procesadas = new Set(opciones.procesadas ?? []);
  const p: Puertos = {
    fireflies: {
      listar: async (saltar) => (saltar === 0 ? remotas : []),
      bajar: async (id) => {
        const t = remotas.find((x) => x.id === id);
        if (!t) {
          throw new Error('no existe');
        }
        return t;
      },
      borrar: async (id) => {
        b.eventos.push(`borrar:${id}`);
        if (opciones.falla?.borrar) {
          throw opciones.falla.borrar;
        }
      }
    },
    drive: {
      carpeta: async () => {
        if (opciones.falla?.carpeta) {
          throw opciones.falla.carpeta;
        }
        return 'carpeta1';
      },
      existente: async () => undefined,
      subir: async (_c, nombre, _texto, ffId) => {
        b.eventos.push(`subir:${ffId}:${nombre}`);
        if (opciones.falla?.subir) {
          throw opciones.falla.subir;
        }
        return { id: `doc-${ffId}`, url: `https://docs.google.com/d/${ffId}` };
      },
      verificar: async (doc) => {
        b.eventos.push(`verificar:${doc.id}`);
        if (opciones.falla?.verificar) {
          throw opciones.falla.verificar;
        }
      }
    },
    borrarDeFireflies: () => opciones.borrar ?? true,
    llamadas: () => b.llamadas,
    guardar: async (lista) => {
      b.eventos.push(
        `guardar:${lista.map((l) => `${l.id}=${l.borradaDeFireflies}`).join(',')}`
      );
      b.llamadas = lista;
    },
    procesada: (id) => procesadas.has(id),
    procesar: async (id) => {
      b.eventos.push(`procesar:${id}`);
      if (opciones.falla?.procesar) {
        throw opciones.falla.procesar;
      }
      procesadas.add(id);
    },
    reemplazarLiga: async (v, n) => {
      b.eventos.push('liga');
      b.ligas.push([v, n]);
    },
    ahora: () => AHORA
  };
  return { p, b };
}

describe('archivarLlamadas', () => {
  it('sube, verifica, anota y solo despues borra de Fireflies', async () => {
    const { p, b } = armar([trans('a')], { procesadas: ['a'] });
    const r = await archivarLlamadas(p);
    assert.deepEqual(
      { a: r.archivadas, b: r.borradas, e: r.errores },
      { a: 1, b: 1, e: [] }
    );
    assert.deepEqual(b.eventos, [
      'subir:a:2026-09-25 — Junta a',
      'verificar:doc-a',
      'guardar:a=false',
      'liga',
      'borrar:a',
      'guardar:a=true'
    ]);
    assert.deepEqual(b.ligas, [
      ['https://app.fireflies.ai/view/a', 'https://docs.google.com/d/a']
    ]);
    assert.equal(b.llamadas[0]?.docUrl, 'https://docs.google.com/d/a');
    assert.equal(b.llamadas[0]?.borradaDeFireflies, true);
  });

  it('si la subida falla no anota ni borra, y lo dice', async () => {
    const { p, b } = armar([trans('a')], {
      procesadas: ['a'],
      falla: { subir: new ErrorProveedor('google', 'Drive respondió 500') }
    });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.equal(r.borradas, 0);
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0] as string, /Drive respondió 500/);
    assert.match(r.errores[0] as string, /se reintenta/);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    assert.equal(b.llamadas.length, 0);
  });

  it('si la verificacion falla no borra ni anota', async () => {
    const { p, b } = armar([trans('a')], {
      procesadas: ['a'],
      falla: { verificar: new Error('no trae el final') }
    });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    assert.ok(!b.eventos.some((e) => e.startsWith('guardar')));
  });

  it('una que falla no frena a las demas', async () => {
    const { p, b } = armar([trans('a'), trans('b')], {
      procesadas: ['a', 'b']
    });
    const subirOriginal = p.drive.subir;
    p.drive.subir = async (c, n, t, id) => {
      if (id === 'a') {
        throw new Error('se cayó');
      }
      return subirOriginal(c, n, t, id);
    };
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 1);
    assert.equal(r.errores.length, 1);
    assert.deepEqual(
      b.llamadas.map((l) => l.id),
      ['b']
    );
  });

  it('con el interruptor apagado guarda el Doc y no borra', async () => {
    const { p, b } = armar([trans('a')], { procesadas: ['a'], borrar: false });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 1);
    assert.equal(r.borradas, 0);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    assert.equal(b.llamadas[0]?.borradaDeFireflies, false);
  });

  it('si Fireflies no deja borrar, el Doc queda anotado y no se insiste con las demas', async () => {
    const { p, b } = armar([trans('a'), trans('b')], {
      procesadas: ['a', 'b'],
      falla: {
        borrar: new ErrorBorradoNoPermitido('require_elevated_privilege')
      }
    });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 2);
    assert.equal(r.borradas, 0);
    assert.equal(b.eventos.filter((e) => e.startsWith('borrar')).length, 1);
    assert.ok(r.errores.some((e) => /no permite borrar/.test(e)));
    assert.ok(b.llamadas.every((l) => !l.borradaDeFireflies));
  });

  const sinBorrar: LlamadaArchivada = {
    id: 'vieja',
    titulo: 'Vieja',
    fecha: '2026-08-01T00:00:00Z',
    participantes: [],
    docUrl: 'u',
    docId: 'd',
    archivadaEn: '2026-08-02T00:00:00Z',
    borradaDeFireflies: false
  };

  it('reintenta los borrados pendientes, verificando antes el Doc', async () => {
    const { p, b } = armar([trans('vieja')], { existentes: [sinBorrar] });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.equal(r.borradas, 1);
    assert.deepEqual(b.eventos.slice(0, 3), [
      'verificar:d',
      'liga',
      'borrar:vieja'
    ]);
    assert.equal(b.llamadas[0]?.borradaDeFireflies, true);
  });

  for (const [caso, falla] of [
    [
      'el Doc está en la papelera',
      new Error('el Doc está en la papelera de Drive')
    ],
    [
      'el Doc se borró de Drive',
      new ErrorProveedor('google', 'Drive respondió 404')
    ],
    [
      'el Doc no trae el contenido',
      new Error('no trae el final de la conversación')
    ]
  ] as const) {
    it(`el reintento no borra de Fireflies si ${caso}`, async () => {
      const { p, b } = armar([trans('vieja')], {
        existentes: [sinBorrar],
        falla: { verificar: falla }
      });
      const r = await archivarLlamadas(p);
      assert.equal(r.borradas, 0);
      assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
      assert.match(r.errores[0] as string, /no se pudo verificar el Doc/);
      assert.equal(b.llamadas[0]?.borradaDeFireflies, false);
    });
  }

  it('el reintento no borra si la cuenta perdió el permiso de Drive', async () => {
    const { p, b } = armar([trans('vieja')], {
      existentes: [sinBorrar],
      falla: { carpeta: new ErrorReconectarGoogle() }
    });
    const r = await archivarLlamadas(p);
    assert.equal(r.borradas, 0);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    assert.equal(r.reconectarGoogle, true);
  });

  it('si el paso de archivar corta por falta de permiso, tampoco reintenta borrados', async () => {
    const { p, b } = armar([trans('a'), trans('vieja')], {
      procesadas: ['a'],
      existentes: [sinBorrar],
      falla: { subir: new ErrorReconectarGoogle() }
    });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.equal(r.reconectarGoogle, true);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    assert.ok(!b.eventos.includes('verificar:d'));
  });

  it('si la llamada ya no está en Fireflies solo se anota como borrada', async () => {
    const { p, b } = armar([], { existentes: [sinBorrar] });
    p.fireflies.bajar = async () => {
      throw new ErrorProveedor('fireflies', 'not found', 404);
    };
    const r = await archivarLlamadas(p);
    assert.equal(r.borradas, 0);
    assert.equal(r.errores.length, 0);
    assert.equal(b.llamadas[0]?.borradaDeFireflies, true);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
  });

  it('con soloArchivar sube los Docs pero no borra ni reintenta borrados', async () => {
    const { p, b } = armar([trans('a'), trans('vieja')], {
      procesadas: ['a'],
      existentes: [sinBorrar]
    });
    const r = await archivarLlamadas(p, { soloArchivar: true });
    assert.equal(r.archivadas, 1);
    assert.equal(r.borradas, 0);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    assert.ok(b.llamadas.every((l) => !l.borradaDeFireflies));
  });

  it('si no se pudo cambiar la liga en los pendientes no borra, y la próxima corrida sí', async () => {
    const { p, b } = armar([trans('a')], { procesadas: ['a'] });
    const liga = p.reemplazarLiga;
    p.reemplazarLiga = async () => {
      throw new Error('disco lleno');
    };
    const r1 = await archivarLlamadas(p);
    assert.equal(r1.archivadas, 1);
    assert.equal(r1.borradas, 0);
    assert.match(r1.errores[0] as string, /no se borra de Fireflies todavía/);
    assert.ok(!b.eventos.some((e) => e.startsWith('borrar')));
    p.reemplazarLiga = liga;
    const r2 = await archivarLlamadas(p);
    assert.equal(r2.borradas, 1);
  });

  it('si falla guardar después de borrar, la corrida conserva su resumen', async () => {
    const { p, b } = armar([trans('a')], { procesadas: ['a'] });
    const guardar = p.guardar;
    p.guardar = async (lista) => {
      if (lista.some((l) => l.borradaDeFireflies)) {
        throw new Error('sin espacio');
      }
      await guardar(lista);
    };
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 1);
    assert.equal(r.borradas, 1);
    assert.ok(r.errores.some((e) => /no se pudo anotar/.test(e)));
    assert.ok(b.eventos.includes('borrar:a'));
  });

  it('pagina saltando las ya archivadas para alcanzar las viejas', async () => {
    const conocidas: LlamadaArchivada[] = Array.from(
      { length: 120 },
      (_, i) => ({
        ...sinBorrar,
        id: `k${i}`,
        borradaDeFireflies: true
      })
    );
    const todas = [...conocidas.map((c) => trans(c.id)), trans('nueva')];
    const { p, b } = armar(todas, {
      procesadas: ['nueva'],
      existentes: conocidas
    });
    p.fireflies.listar = async (saltar, limite) =>
      todas.slice(saltar, saltar + limite);
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 1);
    assert.deepEqual(
      b.llamadas.map((l) => l.id).filter((id) => id === 'nueva'),
      ['nueva']
    );
  });

  it('una sin procesar y con acuerdos se procesa antes de archivar', async () => {
    const { p, b } = armar([
      trans('a', {
        fecha: '2026-09-30T16:00:00Z',
        acuerdos: '**Ana**\nHacer algo'
      })
    ]);
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 1);
    assert.ok(
      b.eventos.indexOf('procesar:a') <
        b.eventos.indexOf('subir:a:2026-09-30 — Junta a')
    );
  });

  it('una junta de 4 días con acuerdos se archiva sin crear pendientes', async () => {
    const { p, b } = armar([
      trans('a', {
        fecha: '2026-09-27T16:00:00Z',
        acuerdos: '**Ana**\nHacer algo'
      })
    ]);
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 1);
    assert.ok(!b.eventos.some((e) => e.startsWith('procesar')));
  });

  it('si no se pueden crear los pendientes de la junta no la archiva ni la borra', async () => {
    const { p, b } = armar(
      [trans('a', { fecha: '2026-09-30T16:00:00Z', acuerdos: 'algo' })],
      {
        falla: { procesar: new Error('IA caída') }
      }
    );
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.ok(
      !b.eventos.some((e) => e.startsWith('subir') || e.startsWith('borrar'))
    );
    assert.match(r.errores[0] as string, /pendientes de la junta/);
  });

  it('espera a las recientes sin procesar y a las que aun no traen conversacion', async () => {
    const reciente = new Date(AHORA.getTime() - 3_600_000).toISOString();
    const { p, b } = armar(
      [
        trans('reciente', { fecha: reciente }),
        trans('vacia', {
          fecha: new Date(AHORA.getTime() - 20 * 3_600_000).toISOString(),
          frases: []
        })
      ],
      { procesadas: [] }
    );
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.equal(r.errores.length, 0);
    assert.ok(
      !b.eventos.some((e) => e.startsWith('subir') || e.startsWith('borrar'))
    );
  });

  it('una conversacion que no cabe en un Doc se queda en Fireflies con aviso', async () => {
    const frases = Array.from({ length: 20_000 }, () => ({
      texto: 'x'.repeat(60),
      hablante: 'Ana'
    }));
    const { p, b } = armar([trans('a', { frases })], { procesadas: ['a'] });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.match(r.errores[0] as string, /demasiado larga/);
    assert.ok(
      !b.eventos.some((e) => e.startsWith('subir') || e.startsWith('borrar'))
    );
  });

  it('respeta el maximo por corrida y cuenta lo que queda', async () => {
    const ts = ['a', 'b', 'c'].map((id) => trans(id));
    const { p } = armar(ts, { procesadas: ['a', 'b', 'c'] });
    const r = await archivarLlamadas(p, { maximo: 2 });
    assert.equal(r.archivadas, 2);
    assert.equal(r.pendientes, 1);
  });

  it('si falta el permiso de Drive corta la corrida y pide reconectar', async () => {
    const { p } = armar([trans('a'), trans('b')], {
      procesadas: ['a', 'b'],
      falla: { carpeta: new ErrorReconectarGoogle() }
    });
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.equal(r.reconectarGoogle, true);
    assert.equal(r.errores.length, 1);
    assert.match(r.errores[0] as string, /reconecta Google/);
  });

  it('una llamada en concreto se archiva sin esperar el reposo', async () => {
    const reciente = new Date(AHORA.getTime() - 3_600_000).toISOString();
    const { p } = armar([trans('a', { fecha: reciente })]);
    const r = await archivarLlamadas(p, { id: 'a' });
    assert.equal(r.archivadas, 1);
  });

  it('no repite una ya archivada', async () => {
    const { p, b } = armar([trans('a')], { procesadas: ['a'] });
    await archivarLlamadas(p);
    b.eventos.length = 0;
    const r = await archivarLlamadas(p);
    assert.equal(r.archivadas, 0);
    assert.deepEqual(b.eventos, []);
  });
});

describe('verificacionDeDoc', () => {
  const texto = 'Titulo\n\nConversación\n[00:01] Ana: adiós y hasta luego.\n';
  const base = {
    token: async () => 't',
    archivo: async () => ({
      id: 'd',
      mimeType: 'application/vnd.google-apps.document',
      parents: ['c']
    }),
    exportar: async () => texto
  };
  const doc = { id: 'd', url: 'u' };

  it('acepta un Doc completo en su carpeta', async () => {
    await verificacionDeDoc(base)(doc, 'c', texto);
  });

  it('exige que el archivo sea el mismo y que traiga carpeta', async () => {
    await assert.rejects(
      verificacionDeDoc({
        ...base,
        archivo: async () => ({
          id: 'otro',
          mimeType: 'application/vnd.google-apps.document',
          parents: ['c']
        })
      })(doc, 'c', texto),
      /otro archivo/
    );
    await assert.rejects(
      verificacionDeDoc({
        ...base,
        archivo: async () => ({
          id: 'd',
          mimeType: 'application/vnd.google-apps.document'
        })
      })(doc, 'c', texto),
      /carpeta/
    );
  });

  it('rechaza papelera, otro tipo, otra carpeta o contenido cortado', async () => {
    await assert.rejects(
      verificacionDeDoc({
        ...base,
        archivo: async () => ({ id: 'd', trashed: true })
      })(doc, 'c', texto),
      /papelera/
    );
    await assert.rejects(
      verificacionDeDoc({
        ...base,
        archivo: async () => ({ id: 'd', mimeType: 'text/plain' })
      })(doc, 'c', texto),
      /Google Doc/
    );
    await assert.rejects(
      verificacionDeDoc({
        ...base,
        archivo: async () => ({
          id: 'd',
          mimeType: 'application/vnd.google-apps.document',
          parents: ['otra']
        })
      })(doc, 'c', texto),
      /carpeta/
    );
    await assert.rejects(
      verificacionDeDoc({
        ...base,
        exportar: async () => 'Titulo\n\nConversación\n[00:01] Ana: adiós'
      })(doc, 'c', texto),
      /final de la conversación/
    );
  });
});
