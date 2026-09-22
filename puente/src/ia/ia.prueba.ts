import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  LicenseUsage,
  Meeting,
  Person,
  TaskItem
} from '../nucleo/contrato.js';
import { personaDe } from './acuerdos.js';
import { detectarAlertas, registrarCostos } from './alertas.js';
import { aplicarVeredictos } from './pendientes.js';
import { semanaIso } from './repos.js';
import { semanaDeCadaQuien } from './semana.js';
import { homologarJuntas, juntasSinHomologar } from '../nucleo/juntas.js';
import {
  diaLocal,
  juntasDelDia,
  paraHoy,
  vencidos,
  type Tablero
} from './tablero.js';

const AHORA = new Date('2026-09-17T15:00:00Z'); // jueves, 9:00 en CDMX

function licencia(parte: Partial<LicenseUsage>): LicenseUsage {
  return {
    id: 'l',
    provider: 'manual',
    product: 'Zoom',
    unit: 'dinero',
    used: 0,
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    manual: true,
    members: [],
    accountId: 'correo-dealer',
    updatedAt: AHORA.toISOString(),
    ...parte
  } as LicenseUsage;
}

function tarea(parte: Partial<TaskItem>): TaskItem {
  return {
    id: 't',
    title: 'Algo',
    status: 'pendiente',
    priority: 'media',
    accountId: 'mios',
    origin: 'local',
    tags: [],
    updatedAt: AHORA.toISOString(),
    ...parte
  };
}

describe('alertas', () => {
  it('avisa cuando un cargo sube respecto al mes anterior registrado', () => {
    const historial = registrarCostos(
      {},
      [licencia({ cost: 100, currency: 'USD' })],
      new Date('2026-08-15T00:00:00Z')
    );
    const alertas = detectarAlertas(
      [licencia({ cost: 140, currency: 'USD' })],
      [],
      historial,
      AHORA
    );
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0]?.tipo, 'sube');
    assert.match(alertas[0]?.titulo ?? '', /40 %/);
  });

  it('no avisa por subidas chicas ni sin historial', () => {
    const historial = registrarCostos(
      {},
      [licencia({ cost: 100 })],
      new Date('2026-08-15T00:00:00Z')
    );
    assert.equal(
      detectarAlertas([licencia({ cost: 105 })], [], historial, AHORA).length,
      0
    );
    assert.equal(
      detectarAlertas([licencia({ cost: 500 })], [], {}, AHORA).length,
      0
    );
  });

  it('detecta la misma suscripcion cobrada en dos cuentas', () => {
    const alertas = detectarAlertas(
      [
        licencia({
          id: 'a',
          product: 'PilloFon',
          cost: 200,
          accountId: 'correo-gmail'
        }),
        licencia({
          id: 'b',
          product: 'PilloFon',
          cost: 200,
          accountId: 'correo-vanguardia'
        })
      ],
      [],
      {},
      AHORA
    );
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0]?.tipo, 'duplicada');
  });

  it('avisa de dominios por vencer sin renovacion automatica y de los vencidos', () => {
    const alertas = detectarAlertas(
      [],
      [
        { nombre: 'pronto.mx', venceEn: '2026-09-25', automatico: false },
        { nombre: 'seguro.mx', venceEn: '2026-09-25', automatico: true },
        { nombre: 'tarde.mx', venceEn: '2026-09-01', automatico: true },
        { nombre: 'lejos.mx', venceEn: '2027-03-01', automatico: false }
      ],
      {},
      AHORA
    );
    assert.deepEqual(
      alertas.map((a) => [a.producto, a.gravedad]),
      [
        ['tarde.mx', 'grave'],
        ['pronto.mx', 'aviso']
      ]
    );
  });

  it('el historial guarda un costo por mes y recorta a trece', () => {
    let historial = {};
    for (let i = 0; i < 20; i++) {
      historial = registrarCostos(
        historial,
        [licencia({ cost: 10 + i })],
        new Date(Date.UTC(2025, i, 15))
      );
    }
    const serie = Object.values(historial)[0] as {
      mes: string;
      costo: number;
    }[];
    assert.equal(serie.length, 13);
    assert.equal(serie[serie.length - 1]?.costo, 29);
  });
});

describe('tablero', () => {
  it('cuenta el dia en la zona del equipo', () => {
    // 05:30Z del 18 todavia es 23:30 del 17 en CDMX.
    assert.equal(diaLocal(new Date('2026-09-18T05:30:00Z')), '2026-09-17');
    assert.equal(diaLocal(AHORA), '2026-09-17');
  });

  it('separa vencidos, para hoy y juntas del dia', () => {
    const tareas = [
      tarea({ id: 'v', dueDate: '2026-09-10T12:00:00Z' }),
      tarea({ id: 'h', dueDate: '2026-09-17T18:00:00Z' }),
      tarea({ id: 'x', dueDate: '2026-09-10T12:00:00Z', status: 'hecho' })
    ];
    assert.deepEqual(
      vencidos(tareas, AHORA).map((t) => t.id),
      ['v']
    );
    assert.deepEqual(
      paraHoy(tareas, AHORA).map((t) => t.id),
      ['h']
    );
    const juntas: Meeting[] = [
      junta('a', '2026-09-17T20:00:00Z'),
      junta('b', '2026-09-18T20:00:00Z'),
      { ...junta('c', '2026-09-17T16:00:00Z'), status: 'cancelada' }
    ];
    assert.deepEqual(
      juntasDelDia(juntas, AHORA).map((j) => j.id),
      ['a']
    );
  });
});

function junta(id: string, start: string): Meeting {
  return {
    id,
    title: id,
    start,
    end: new Date(Date.parse(start) + 3_600_000).toISOString(),
    allDay: false,
    accountId: 'correo-nexus',
    status: 'confirmada',
    attendees: []
  };
}

describe('semana del equipo', () => {
  const matias: Person = {
    id: 'matias',
    name: 'Matías López',
    email: 'matias@itechdev.com.mx'
  };
  const pablo: Person = {
    id: 'pablo',
    name: 'Pablo Ruiz',
    email: 'pablo@itechdev.com.mx'
  };

  it('a cada quien lo suyo: asignados, vencidos y juntas donde va', () => {
    const tablero: Tablero = {
      pendientes: [
        tarea({ id: 'a', dueDate: '2026-09-20T12:00:00Z' }),
        tarea({ id: 'b', dueDate: '2026-09-10T12:00:00Z' }),
        tarea({ id: 'c' })
      ],
      juntas: [
        { ...junta('j1', '2026-09-18T16:00:00Z'), attendees: [matias] },
        { ...junta('j2', '2026-10-18T16:00:00Z'), attendees: [matias] },
        {
          ...junta('j3', '2026-09-19T16:00:00Z'),
          organizer: pablo,
          attendees: []
        }
      ],
      juntasSinHomologar: [],
      licencias: [],
      dominios: [],
      monitoreo: [],
      despliegues: [],
      repos: [],
      equipo: [matias, pablo, { id: 'sin-correo', name: 'Nadie' }],
      errores: [],
      armadoEn: AHORA.toISOString()
    };
    const semanas = semanaDeCadaQuien(
      tablero,
      {
        a: { comentarios: [], asignado: matias, actualizadoEn: '' },
        b: { comentarios: [], asignado: matias, actualizadoEn: '' },
        c: { comentarios: [], asignado: pablo, actualizadoEn: '' }
      },
      AHORA
    );
    const deMatias = semanas.find((s) => s.persona.id === 'matias');
    assert.deepEqual(
      deMatias?.pendientes.map((t) => t.id),
      ['a']
    );
    assert.deepEqual(
      deMatias?.vencidos.map((t) => t.id),
      ['b']
    );
    assert.deepEqual(
      deMatias?.juntas.map((j) => j.id),
      ['j1']
    );
    const dePablo = semanas.find((s) => s.persona.id === 'pablo');
    assert.deepEqual(
      dePablo?.pendientes.map((t) => t.id),
      ['c']
    );
    assert.deepEqual(
      dePablo?.juntas.map((j) => j.id),
      ['j3']
    );
    assert.equal(semanas.length, 2);
  });

  it('encuentra a la persona por correo, nombre completo o nombre de pila', () => {
    const equipo = [matias, pablo];
    assert.equal(personaDe('matias@itechdev.com.mx', equipo)?.id, 'matias');
    assert.equal(personaDe('Pablo Ruiz', equipo)?.id, 'pablo');
    assert.equal(personaDe('lo hace Matías el viernes', equipo)?.id, 'matias');
    assert.equal(personaDe('Giovana', equipo), undefined);
  });
});

describe('veredictos y semanas', () => {
  it('la IA sube la prioridad pero no la baja, y pone empresa donde falta', () => {
    const [t] = aplicarVeredictos([tarea({ id: 'x', priority: 'alta' })], {
      x: {
        id: 'x',
        empresa: 'Dealer Solutions',
        prioridad: 'media',
        analizadoEn: ''
      }
    });
    assert.equal(t?.priority, 'alta');
    assert.equal(t?.company, 'Dealer Solutions');
    const [u] = aplicarVeredictos(
      [tarea({ id: 'y', priority: 'baja', company: 'Itech Dev' })],
      {
        y: {
          id: 'y',
          empresa: 'NexusQTech',
          prioridad: 'urgente',
          analizadoEn: ''
        }
      }
    );
    assert.equal(u?.priority, 'urgente');
    assert.equal(u?.company, 'Itech Dev');
  });

  it('numera la semana ISO', () => {
    assert.equal(semanaIso(new Date('2026-09-17T12:00:00Z')), '2026-W38');
    assert.equal(semanaIso(new Date('2026-01-01T12:00:00Z')), '2026-W01');
    assert.equal(semanaIso(new Date('2027-01-01T12:00:00Z')), '2026-W53');
  });
});

describe('homologacion de juntas', () => {
  it('funde la misma junta de dos cuentas y avisa de la que falta', () => {
    const daily = { ...junta('a', '2026-09-18T13:00:00Z'), title: 'Daily' };
    const copia = {
      ...daily,
      id: 'b',
      title: 'DAILY ',
      accountId: 'correo-itech'
    };
    const sola = { ...junta('c', '2026-09-18T15:00:00Z'), title: 'Reunion' };
    const juntas = homologarJuntas([daily, copia, sola]);
    assert.equal(juntas.length, 2);
    assert.deepEqual(juntas[0]?.alsoIn, ['correo-itech']);
    assert.equal(juntas[1]?.alsoIn, undefined);
    const faltan = juntasSinHomologar(
      juntas,
      ['correo-nexus', 'correo-itech'],
      AHORA
    );
    assert.deepEqual(
      faltan.map((u) => [u.junta.id, u.faltaEn]),
      [['c', ['correo-itech']]]
    );
    assert.equal(juntasSinHomologar(juntas, ['correo-nexus'], AHORA).length, 0);
  });
});

describe('dictado por reglas', () => {
  it('saca fecha, empresa, prioridad y responsable de una frase', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const equipo: Person[] = [{ id: 'efren', name: 'Efrén' }];
    const [a, b] = interpretarPorReglas(
      'Junta con Felipe el lunes a las 12 en Italian Coffee de Galerías, es de Operativ AI. Y que Efrén revise el alta de proveedores de Vanguardia, urgente',
      equipo,
      new Date('2026-09-17T15:00:00Z') // jueves
    );
    assert.equal(a?.empresa, 'OperativAI');
    assert.equal(
      a?.venceEn,
      new Date('2026-09-21T12:00:00-06:00').toISOString()
    );
    assert.equal(a?.persona, undefined);
    assert.equal(b?.persona?.id, 'efren');
    assert.equal(b?.prioridad, 'urgente');
    assert.equal(b?.proyecto, 'Vanguardia');
    assert.equal(b?.personal, false);
  });

  it('«con alguien del equipo» es el responsable y se quita del título y la descripción', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const equipo: Person[] = [
      {
        id: 'marco',
        name: 'Marco Ramos',
        email: 'marco.ramos@nexusqtech.com'
      }
    ];
    const [p] = interpretarPorReglas(
      'Dar seguimiento a la instalación de AutoScope con Marco Ramos',
      equipo
    );
    assert.equal(p?.persona?.id, 'marco');
    assert.equal(p?.responsable, 'Marco Ramos');
    assert.equal(p?.titulo, 'Dar seguimiento a la instalación de AutoScope');
    assert.equal(
      p?.descripcion,
      'Dar seguimiento a la instalación de AutoScope'
    );
    assert.equal(p?.titulo.includes('con Marco'), false);
  });

  it('«con alguien» que no está en el equipo se deja como está', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const [p] = interpretarPorReglas(
      'Dar seguimiento a AutoScope con Juan Pérez',
      [{ id: 'marco', name: 'Marco Ramos' }]
    );
    assert.equal(p?.persona, undefined);
    assert.match(p?.titulo ?? '', /con Juan Pérez/);
  });

  it('no pisa un responsable de «que X revise» por un «con» de otra persona', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const equipo: Person[] = [
      { id: 'efren', name: 'Efrén' },
      { id: 'marco', name: 'Marco Ramos' }
    ];
    const [p] = interpretarPorReglas(
      'Que Efrén revise la instalación de AutoScope con Marco Ramos',
      equipo
    );
    assert.equal(p?.persona?.id, 'efren');
    assert.match(p?.titulo ?? '', /con Marco Ramos/);
  });

  it('tampoco pisa a Efrén si Marco va primero en el equipo', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const [p] = interpretarPorReglas(
      'Que Efrén revise la instalación de AutoScope con Marco Ramos',
      [
        { id: 'marco', name: 'Marco Ramos' },
        { id: 'efren', name: 'Efrén' }
      ]
    );
    assert.equal(p?.persona?.id, 'efren');
    assert.match(p?.titulo ?? '', /con Marco Ramos/);
  });

  it('«con Marco el lunes» solo quita el nombre, no la fecha', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const [p] = interpretarPorReglas(
      'Junta con Marco el lunes a las 12 en Italian Coffee',
      [{ id: 'marco', name: 'Marco Ramos' }],
      new Date('2026-09-17T15:00:00Z')
    );
    assert.equal(p?.persona?.id, 'marco');
    assert.match(p?.titulo ?? '', /lunes/);
    assert.equal(/\bcon Marco\b/i.test(p?.titulo ?? ''), false);
  });

  it('«con datos de Marco» no recorta el título', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const frase = 'Continuar con datos de Marco para AutoScope';
    const [p] = interpretarPorReglas(frase, [
      { id: 'marco', name: 'Marco Ramos' }
    ]);
    assert.match(p?.titulo ?? '', /con datos de Marco/);
  });

  it('la voz en minúsculas («con marco ramos») también asigna y limpia', async () => {
    const { interpretarPorReglas } = await import('./dictado.js');
    const [p] = interpretarPorReglas(
      'dar seguimiento a autoscope con marco ramos',
      [
        {
          id: 'marco',
          name: 'Marco Ramos',
          email: 'marco.ramos@nexusqtech.com'
        }
      ]
    );
    assert.equal(p?.persona?.id, 'marco');
    assert.equal(/\bcon marco ramos\b/i.test(p?.titulo ?? ''), false);
  });

  it('el mismo dia de la semana apunta a la proxima semana, y "mañana a las 5 pm" a la tarde', async () => {
    const { fechaDeFrase } = await import('./dictado.js');
    const jueves = new Date('2026-09-17T15:00:00Z');
    assert.equal(
      fechaDeFrase('el jueves', jueves),
      new Date('2026-09-24T12:00:00-06:00').toISOString()
    );
    assert.equal(
      fechaDeFrase('manana a las 5 pm', jueves),
      new Date('2026-09-18T17:00:00-06:00').toISOString()
    );
    assert.equal(fechaDeFrase('sin fecha', jueves), undefined);
  });
});

describe('acuerdos de Fireflies', () => {
  it('lee los action items por persona y los empareja con el equipo', async () => {
    const { leerAcuerdos } = await import('./juntas-fireflies.js');
    const texto = `
**Carlos**
Compartir el API para incluir ID de cuenta (11:39)
Preparar conexión y mapeo para Salesforce en sandbox (11:38)

**Johana**
- Actualizar los registros para enviar el monto pendiente (06:01)

**Equipo (Carlos, Johana y Marcos)**
Realizar pruebas integradas el martes o miércoles próximos (12:05)
`;
    const equipo: Person[] = [
      { id: 'carlos', name: 'Carlos Limón', email: 'carlos@x.com' }
    ];
    const acuerdos = leerAcuerdos(texto, equipo);
    assert.equal(acuerdos.length, 4);
    assert.equal(
      acuerdos[0]?.titulo,
      'Compartir el API para incluir ID de cuenta'
    );
    assert.equal(acuerdos[0]?.persona?.id, 'carlos');
    assert.equal(acuerdos[2]?.responsable, 'Johana');
    assert.equal(acuerdos[2]?.persona, undefined);
    assert.equal(acuerdos[3]?.responsable, undefined);
  });
});

describe('liga personal', () => {
  it('vence a las tres de la tarde del dia, o del siguiente si ya pasaron', async () => {
    const { proximasTres } = await import('../servidor/rutas.js');
    // 10:00 CDMX (16:00Z) → hoy 15:00 CDMX (21:00Z)
    assert.equal(
      proximasTres(new Date('2026-09-17T16:00:00Z')),
      '2026-09-17T21:00:00.000Z'
    );
    // 16:30 CDMX (22:30Z) → mañana 15:00 CDMX
    assert.equal(
      proximasTres(new Date('2026-09-17T22:30:00Z')),
      '2026-09-18T21:00:00.000Z'
    );
  });

  it('la de asignación vence al final del día en que se mandó', async () => {
    const { finDelDia } = await import('../servidor/rutas.js');
    // 22:00 CDMX del 17 (04:00Z del 18) → 23:59:59 CDMX del 17 (05:59:59Z del 18)
    assert.equal(
      finDelDia(new Date('2026-09-18T04:00:00Z')),
      '2026-09-18T05:59:59.000Z'
    );
  });
});
