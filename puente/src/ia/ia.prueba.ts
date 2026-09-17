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
