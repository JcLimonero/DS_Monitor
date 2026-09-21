import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import {
  EMPRESAS_INICIALES,
  contextoEmpresas,
  empresaDeCuenta,
  empresaPorPalabra,
  empresaValida,
  idDeEmpresa,
  opcionesEmpresa,
  pendientesAbiertosDe,
  renombrarEmpresa,
  validarCatalogo,
  validarEmpresa,
  type Empresa
} from './empresas.js';

const AHORA = '2026-09-21T12:00:00.000Z';

const empresa = (nombre: string, extra: Partial<Empresa> = {}): Empresa => ({
  id: idDeEmpresa(nombre),
  nombre,
  cuentas: [],
  activa: true,
  orden: 0,
  actualizadoEn: AHORA,
  ...extra
});

const tarea = (
  id: string,
  company: string | undefined,
  status: TaskItem['status'] = 'pendiente'
): TaskItem => ({
  id,
  title: id,
  company,
  status,
  priority: 'media',
  accountId: 'correo-itech',
  origin: 'correo',
  tags: [],
  updatedAt: AHORA
});

describe('validarEmpresa', () => {
  it('exige nombre, recorta y deriva el id la primera vez', () => {
    const e = validarEmpresa(
      { nombre: '  Total One ', descripcion: ' CRM ', color: 'Sky' },
      undefined,
      AHORA,
      3
    );
    assert.equal(e.id, 'total-one');
    assert.equal(e.nombre, 'Total One');
    assert.equal(e.descripcion, 'CRM');
    assert.equal(e.color, 'sky');
    assert.equal(e.activa, true);
    assert.equal(e.orden, 3);
    assert.equal(e.actualizadoEn, AHORA);
    assert.throws(
      () => validarEmpresa({ nombre: '  ' }, undefined, AHORA),
      /necesita un nombre/
    );
  });

  it('conserva el id previo aunque cambie el nombre y limpia las cuentas', () => {
    const previa = empresa('Itech Dev', { id: 'itech-dev', cuentas: ['a'] });
    const e = validarEmpresa(
      {
        id: 'itech-dev',
        nombre: 'Itech',
        cuentas: [' correo-itech ', '', 'correo-itech', 7],
        activa: false
      },
      previa,
      '2026-09-22T00:00:00.000Z'
    );
    assert.equal(e.id, 'itech-dev');
    assert.deepEqual(e.cuentas, ['correo-itech']);
    assert.equal(e.activa, false);
    assert.equal(e.actualizadoEn, '2026-09-22T00:00:00.000Z');
  });

  it('sin cambios conserva la fecha de la ultima edicion', () => {
    const previa = EMPRESAS_INICIALES[0] as Empresa;
    const e = validarEmpresa({ ...previa }, previa, AHORA, 0);
    assert.equal(e.actualizadoEn, previa.actualizadoEn);
  });

  it('rechaza un color que no sea un nombre', () => {
    assert.throws(
      () => validarEmpresa({ nombre: 'X', color: 'red;' }, undefined, AHORA),
      /color/
    );
  });
});

describe('validarCatalogo', () => {
  it('no deja dos empresas con el mismo nombre, sin importar mayusculas ni acentos', () => {
    assert.throws(
      () =>
        validarCatalogo(
          [{ nombre: 'Itech Dev' }, { nombre: 'ítech  dev' }],
          [],
          AHORA
        ),
      /misma empresa/
    );
  });

  it('no deja un buzon en dos empresas', () => {
    assert.throws(
      () =>
        validarCatalogo(
          [
            { nombre: 'A', cuentas: ['correo-x'] },
            { nombre: 'B', cuentas: ['Correo-X'] }
          ],
          [],
          AHORA
        ),
      /un buzón pertenece a una sola empresa/
    );
  });

  it('numera el orden como viene y evita ids repetidos', () => {
    const lista = validarCatalogo(
      [{ nombre: 'Total One' }, { nombre: 'Total-One!' }],
      [],
      AHORA
    );
    // Los nombres son distintos ("total one" vs "total-one!") pero el id
    // derivado coincide: el segundo recibe sufijo.
    assert.deepEqual(
      lista.map((e) => [e.id, e.orden]),
      [
        ['total-one', 0],
        ['total-one-2', 1]
      ]
    );
  });
});

describe('contextoEmpresas y opcionesEmpresa', () => {
  it('arma la frase de siempre con las cuatro iniciales', () => {
    assert.equal(
      contextoEmpresas(EMPRESAS_INICIALES),
      'Trabajas para un grupo con cuatro empresas: Itech Dev (desarrollo de software a la medida), Dealer Solutions (software para agencias automotrices), NexusQTech (integraciones y tecnologia para grupos automotrices) y OperativAI (agentes de IA). Escribes en español de México, directo y sin adornos.'
    );
    assert.equal(
      opcionesEmpresa(EMPRESAS_INICIALES),
      'Itech Dev|Dealer Solutions|NexusQTech|OperativAI|null'
    );
  });

  it('omite las inactivas y respeta el orden', () => {
    const lista = [
      empresa('B', { orden: 2 }),
      empresa('A', { orden: 1, descripcion: 'la primera' }),
      empresa('C', { orden: 3, activa: false })
    ];
    assert.equal(
      contextoEmpresas(lista),
      'Trabajas para un grupo con dos empresas: B y A (la primera). Escribes en español de México, directo y sin adornos.'
    );
    assert.equal(opcionesEmpresa(lista), 'B|A|null');
  });

  it('con una sola o ninguna no habla de grupo', () => {
    assert.match(
      contextoEmpresas([empresa('Solo', { descripcion: 'x' })]),
      /^Trabajas para una empresa: Solo \(x\)\./
    );
    assert.match(contextoEmpresas([]), /^Trabajas para un grupo de empresas\./);
  });
});

describe('empresaValida', () => {
  it('devuelve el nombre del catalogo y tolera mayusculas', () => {
    assert.equal(empresaValida('itech dev', EMPRESAS_INICIALES), 'Itech Dev');
    assert.equal(empresaValida('Total One', EMPRESAS_INICIALES), undefined);
    assert.equal(empresaValida(null, EMPRESAS_INICIALES), undefined);
  });
});

describe('empresaDeCuenta', () => {
  it('usa las cuentas del catalogo', () => {
    const lista = [
      ...EMPRESAS_INICIALES,
      empresa('Total One', { orden: 9, cuentas: ['correo-gmail'] })
    ];
    assert.equal(empresaDeCuenta('correo-gmail', lista), 'Total One');
    assert.equal(empresaDeCuenta('correo-dealer', lista), 'Dealer Solutions');
    assert.equal(empresaDeCuenta('CORREO-NEXUS', lista), 'NexusQTech');
  });

  it('sin mapeo cae a las pistas del identificador, solo si la empresa sigue en el catalogo', () => {
    const sinCuentas = EMPRESAS_INICIALES.map((e) => ({ ...e, cuentas: [] }));
    assert.equal(empresaDeCuenta('correo-itech', sinCuentas), 'Itech Dev');
    assert.equal(empresaDeCuenta('correo-outlook', sinCuentas), 'NexusQTech');
    assert.equal(empresaDeCuenta('correo-gmail', sinCuentas), undefined);
    assert.equal(
      empresaDeCuenta('correo-dealer', [empresa('Total One')]),
      undefined
    );
  });

  it('un buzon reasignado se va con la empresa nueva aunque el id diga otra cosa', () => {
    const lista = [
      ...EMPRESAS_INICIALES.map((e) => ({ ...e, cuentas: [] })),
      empresa('Total One', { orden: 9, cuentas: ['correo-dealer'] })
    ];
    assert.equal(empresaDeCuenta('correo-dealer', lista), 'Total One');
  });
});

describe('empresaPorPalabra', () => {
  it('reconoce las cuatro de siempre como antes', () => {
    assert.equal(
      empresaPorPalabra('es de OperativAI', EMPRESAS_INICIALES),
      'OperativAI'
    );
    assert.equal(
      empresaPorPalabra('lo de nexus va urgente', EMPRESAS_INICIALES),
      'NexusQTech'
    );
    assert.equal(
      empresaPorPalabra('para Dealer', EMPRESAS_INICIALES),
      'Dealer Solutions'
    );
    assert.equal(
      empresaPorPalabra('Itech: revisar', EMPRESAS_INICIALES),
      'Itech Dev'
    );
    assert.equal(empresaPorPalabra('sin pista', EMPRESAS_INICIALES), undefined);
  });

  it('reconoce una empresa nueva por su nombre completo', () => {
    const lista = [...EMPRESAS_INICIALES, empresa('Total One', { orden: 9 })];
    assert.equal(empresaPorPalabra('el CRM de total one', lista), 'Total One');
  });
});

describe('renombrarEmpresa', () => {
  it('reetiqueta correo, personales, anotaciones y aprendido, y deja lo demas igual', () => {
    const datos = {
      registroCorreo: {
        'correo-dealer': [
          tarea('a', 'Dealer Solutions'),
          tarea('b', 'Itech Dev')
        ],
        'correo-itech': [tarea('c', 'Itech Dev')]
      },
      anotaciones: {
        a: { comentarios: [], actualizadoEn: AHORA },
        b: {
          comentarios: [],
          cambios: { company: 'dealer solutions', title: 'Otro' },
          actualizadoEn: AHORA
        }
      },
      personales: [tarea('p', 'Dealer Solutions'), tarea('q', undefined)],
      aprendido: {
        'x@y.com': { company: 'Dealer Solutions', veces: 1, en: AHORA },
        'z@y.com': { company: 'Itech Dev', veces: 1, en: AHORA }
      }
    };
    const { datos: nuevos, tocados } = renombrarEmpresa(
      datos,
      'Dealer Solutions',
      'Dealer'
    );
    assert.equal(tocados, 4);
    assert.equal(
      nuevos.registroCorreo['correo-dealer']?.[0]?.company,
      'Dealer'
    );
    assert.equal(
      nuevos.registroCorreo['correo-dealer']?.[1]?.company,
      'Itech Dev'
    );
    // La cuenta que no cambio conserva la misma lista.
    assert.equal(
      nuevos.registroCorreo['correo-itech'],
      datos.registroCorreo['correo-itech']
    );
    assert.equal(nuevos.anotaciones['b']?.cambios?.company, 'Dealer');
    assert.equal(nuevos.anotaciones['b']?.cambios?.title, 'Otro');
    assert.equal(nuevos.anotaciones['a'], datos.anotaciones['a']);
    assert.equal(nuevos.personales[0]?.company, 'Dealer');
    assert.equal(nuevos.personales[1]?.company, undefined);
    assert.equal(nuevos.aprendido['x@y.com']?.company, 'Dealer');
    assert.equal(nuevos.aprendido['z@y.com'], datos.aprendido['z@y.com']);
    // Lo de entrada no se toco.
    assert.equal(
      datos.registroCorreo['correo-dealer']?.[0]?.company,
      'Dealer Solutions'
    );
  });

  it('sin coincidencias devuelve los mismos objetos', () => {
    const datos = {
      registroCorreo: { c: [tarea('a', 'Itech Dev')] },
      anotaciones: {},
      personales: [],
      aprendido: {}
    };
    const { datos: nuevos, tocados } = renombrarEmpresa(datos, 'Nada', 'Otra');
    assert.equal(tocados, 0);
    assert.equal(nuevos.registroCorreo, datos.registroCorreo);
    assert.equal(nuevos.anotaciones, datos.anotaciones);
    assert.equal(nuevos.personales, datos.personales);
    assert.equal(nuevos.aprendido, datos.aprendido);
  });
});

describe('pendientesAbiertosDe', () => {
  it('cuenta solo los no hechos de esa empresa', () => {
    const lista = [
      tarea('a', 'Itech Dev'),
      tarea('b', 'itech dev', 'en_progreso'),
      tarea('c', 'Itech Dev', 'hecho'),
      tarea('d', 'Dealer Solutions')
    ];
    assert.equal(pendientesAbiertosDe('Itech Dev', lista), 2);
    assert.equal(pendientesAbiertosDe('Total One', lista), 0);
  });
});
