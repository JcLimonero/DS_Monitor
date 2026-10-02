import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from '../pendientes/anotaciones.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import {
  REPOSO_HORAS,
  cabeEnUnDoc,
  contenidoCompleto,
  marcaDeTiempo,
  nombreDeArchivo,
  porArchivar,
  reemplazarLigaDeJunta,
  reemplazarLigaEnAnotaciones,
  textoDeTranscripcion
} from './archivar.js';

const AHORA = new Date('2026-10-01T18:00:00Z');

function trans(parte: Partial<Transcripcion>): Transcripcion {
  return {
    id: 'ff1',
    titulo: 'Junta con Vanguardia',
    fecha: '2026-09-30T16:30:00Z',
    participantes: [],
    ...parte
  };
}

describe('textoDeTranscripcion', () => {
  it('arma encabezado y conversacion linea por linea con marca de tiempo', () => {
    const t = trans({
      duracionMin: 45,
      participantes: ['ana@dealer.mx', 'beto@vanguardia.mx'],
      resumen: 'Se revisó el avance del piloto.',
      acuerdos: '**Ana**\nEnviar la propuesta (02:10)',
      frases: [
        { texto: 'Buenos días a todos.', hablante: 'Ana', inicioSeg: 5 },
        { texto: 'Hola, ¿cómo están?', hablante: 'Beto', inicioSeg: 3725 },
        { texto: 'Sin nombre ni marca' }
      ]
    });
    const texto = textoDeTranscripcion(t);
    const lineas = texto.split('\n');
    assert.equal(lineas[0], 'Junta con Vanguardia');
    assert.match(texto, /Fecha: .*30 de septiembre de 2026/);
    assert.match(texto, /10:30/); // 16:30Z = 10:30 en CDMX
    assert.match(texto, /Duración: 45 min/);
    assert.match(texto, /Participantes: ana@dealer.mx, beto@vanguardia.mx/);
    assert.match(texto, /\nResumen\nSe revisó el avance del piloto\./);
    assert.match(texto, /\nAcuerdos\n\*\*Ana\*\*\nEnviar la propuesta/);
    assert.ok(texto.includes('\nConversación\n'));
    assert.ok(texto.includes('[00:05] Ana: Buenos días a todos.'));
    assert.ok(texto.includes('[1:02:05] Beto: Hola, ¿cómo están?'));
    assert.ok(texto.includes('\nSin nombre ni marca\n'));
  });

  it('no recorta la conversacion aunque sea larga y omite lo que no viene', () => {
    const frases = Array.from({ length: 3000 }, (_, i) => ({
      texto: `frase número ${i} con algo de relleno para pesar`,
      hablante: 'Ana'
    }));
    const texto = textoDeTranscripcion(trans({ frases }));
    assert.ok(texto.length > 100_000);
    assert.ok(texto.includes('frase número 2999'));
    assert.ok(!texto.includes('Duración:'));
    assert.ok(!texto.includes('Participantes:'));
    assert.ok(!texto.includes('\nResumen\n'));
  });

  it('avisa cuando no hay conversacion', () => {
    assert.match(
      textoDeTranscripcion(trans({ frases: [] })),
      /\(sin conversación transcrita\)/
    );
  });
});

describe('marcaDeTiempo', () => {
  it('da mm:ss y h:mm:ss', () => {
    assert.equal(marcaDeTiempo(0), '00:00');
    assert.equal(marcaDeTiempo(59.9), '00:59');
    assert.equal(marcaDeTiempo(600), '10:00');
    assert.equal(marcaDeTiempo(3661), '1:01:01');
  });
});

describe('nombreDeArchivo', () => {
  it('lleva la fecha de CDMX primero y limpia el titulo', () => {
    assert.equal(
      nombreDeArchivo(trans({})),
      '2026-09-30 — Junta con Vanguardia'
    );
    // 02:00Z del 1 de octubre sigue siendo 30 de septiembre en CDMX.
    assert.equal(
      nombreDeArchivo(
        trans({ titulo: ' Sync / Q4 \n plan ', fecha: '2026-10-01T02:00:00Z' })
      ),
      '2026-09-30 — Sync Q4 plan'
    );
  });

  it('sin fecha valida deja solo el titulo y acota el largo', () => {
    assert.equal(
      nombreDeArchivo(trans({ fecha: '', titulo: 'Solo título' })),
      'Solo título'
    );
    const largo = nombreDeArchivo(trans({ titulo: 'x'.repeat(500) }));
    assert.ok(largo.length <= 150);
  });
});

describe('porArchivar', () => {
  const procesadas = { ya: { en: 'x' } };

  it('omite las ya archivadas y repetidas', () => {
    const r = porArchivar(
      [trans({ id: 'a' }), trans({ id: 'b' }), trans({ id: 'b' })],
      [{ id: 'a' }],
      {},
      { ahora: AHORA }
    );
    assert.deepEqual(
      r.map((d) => d.transcripcion.id),
      ['b']
    );
  });

  it('las procesadas se archivan sin esperar; las recientes sin procesar esperan', () => {
    const reciente = new Date(AHORA.getTime() - 3_600_000).toISOString();
    const r = porArchivar(
      [
        trans({ id: 'ya', fecha: reciente }),
        trans({ id: 'nueva', fecha: reciente, acuerdos: 'algo' })
      ],
      [],
      procesadas,
      { ahora: AHORA }
    );
    assert.deepEqual(
      r.map((d) => [d.transcripcion.id, d.accion]),
      [['ya', 'archivar']]
    );
  });

  it('con acuerdos y sin procesar: primero procesar; sin acuerdos: archivar', () => {
    const vieja = new Date(
      AHORA.getTime() - (REPOSO_HORAS + 1) * 3_600_000
    ).toISOString();
    const r = porArchivar(
      [
        trans({ id: 'con', fecha: vieja, acuerdos: '**Ana**\nHacer algo' }),
        trans({ id: 'sin', fecha: vieja, acuerdos: '  ' })
      ],
      [],
      {},
      { ahora: AHORA }
    );
    assert.deepEqual(
      r.map((d) => [d.transcripcion.id, d.accion]),
      [
        ['con', 'procesar-y-archivar'],
        ['sin', 'archivar']
      ]
    );
  });

  it('forzar salta el reposo', () => {
    const reciente = new Date(AHORA.getTime() - 60_000).toISOString();
    const r = porArchivar(
      [trans({ id: 'a', fecha: reciente })],
      [],
      {},
      {
        ahora: AHORA,
        forzar: true
      }
    );
    assert.equal(r.length, 1);
  });
});

describe('verificacion del contenido', () => {
  it('el documento exportado trae el final aunque cambien los espacios', () => {
    const subido =
      'Titulo\n\nConversación\n[00:01] Ana: Nos vemos mañana, gracias.\n';
    assert.ok(
      contenidoCompleto(
        subido,
        'Titulo\r\n\r\nConversación\r\n[00:01]  Ana: Nos vemos mañana, gracias.'
      )
    );
    assert.ok(
      !contenidoCompleto(
        subido,
        'Titulo\n\nConversación\n[00:01] Ana: Nos vemos'
      )
    );
  });

  it('cabeEnUnDoc respeta el tope', () => {
    assert.ok(cabeEnUnDoc('x'.repeat(1000)));
    assert.ok(!cabeEnUnDoc('x'.repeat(950_000)));
  });
});

function pendiente(parte: Partial<TaskItem>): TaskItem {
  return {
    id: 't',
    title: 'Algo',
    status: 'pendiente',
    priority: 'media',
    accountId: 'mios',
    origin: 'local',
    tags: [],
    updatedAt: '2026-10-01T00:00:00Z',
    ...parte
  };
}

describe('reemplazarLigaDeJunta', () => {
  const vieja = 'https://app.fireflies.ai/view/abc123';
  const nueva = 'https://docs.google.com/document/d/XYZ/edit';

  it('cambia url y descripcion del padre y de los convertidos; no toca el resto', () => {
    const tareas = [
      pendiente({
        id: 'fireflies-abc123',
        url: vieja,
        description: `Fecha: 30 sep\n${vieja}\nResumen`
      }),
      pendiente({
        id: 'local-ff-1',
        description: `Convertido de la junta: Junta\n${vieja}`
      }),
      pendiente({
        id: 'otro',
        description: 'Nada que ver',
        url: 'https://x.mx'
      })
    ];
    const r = reemplazarLigaDeJunta(tareas, vieja, nueva);
    assert.equal(r.cambios, 2);
    assert.equal(r.tareas[0]?.url, nueva);
    assert.ok(r.tareas[0]?.description?.includes(nueva));
    assert.ok(!r.tareas[0]?.description?.includes(vieja));
    assert.ok(r.tareas[1]?.description?.endsWith(nueva));
    assert.equal(r.tareas[2], tareas[2]);
  });

  it('sin coincidencias devuelve la misma lista', () => {
    const tareas = [pendiente({ description: 'sin liga' })];
    const r = reemplazarLigaDeJunta(tareas, vieja, nueva);
    assert.equal(r.cambios, 0);
    assert.equal(r.tareas, tareas);
    assert.equal(reemplazarLigaDeJunta(tareas, '', nueva).cambios, 0);
    assert.equal(reemplazarLigaDeJunta(tareas, vieja, vieja).cambios, 0);
  });

  it('tambien cambia la descripcion editada en las anotaciones', () => {
    const notas: Anotaciones = {
      a: {
        comentarios: [],
        actualizadoEn: 'x',
        cambios: { description: `Editada ${vieja} fin` }
      },
      b: { comentarios: [], actualizadoEn: 'x' }
    };
    const r = reemplazarLigaEnAnotaciones(notas, vieja, nueva);
    assert.equal(r.cambios, 1);
    assert.equal(
      r.anotaciones['a']?.cambios?.description,
      `Editada ${nueva} fin`
    );
    assert.equal(r.anotaciones['b'], notas['b']);
  });
});
