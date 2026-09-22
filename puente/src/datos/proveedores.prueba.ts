import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import {
  PROVEEDORES_INICIALES,
  contextoProveedores,
  idDeProveedor,
  opcionesProveedor,
  pendientesAbiertosDeProveedor,
  proveedorPorPalabra,
  proveedorValido,
  renombrarProveedor,
  validarCatalogoProveedores,
  validarProveedor,
  type Proveedor
} from './proveedores.js';

const AHORA = '2026-09-21T12:00:00.000Z';

const proveedor = (
  nombre: string,
  extra: Partial<Proveedor> = {}
): Proveedor => ({
  id: idDeProveedor(nombre),
  nombre,
  activa: true,
  orden: 0,
  actualizadoEn: AHORA,
  ...extra
});

const tarea = (
  id: string,
  project: string | undefined,
  status: TaskItem['status'] = 'pendiente'
): TaskItem => ({
  id,
  title: id,
  project,
  status,
  priority: 'media',
  accountId: 'correo-itech',
  origin: 'correo',
  tags: [],
  updatedAt: AHORA
});

describe('validarProveedor', () => {
  it('exige nombre, recorta y deriva el id la primera vez', () => {
    const p = validarProveedor(
      {
        nombre: '  Grupo Vanguardia ',
        descripcion: ' agencias ',
        color: 'Sky'
      },
      undefined,
      AHORA,
      3
    );
    assert.equal(p.id, 'grupo-vanguardia');
    assert.equal(p.nombre, 'Grupo Vanguardia');
    assert.equal(p.descripcion, 'agencias');
    assert.equal(p.color, 'sky');
    assert.equal(p.activa, true);
    assert.equal(p.orden, 3);
    assert.equal(p.actualizadoEn, AHORA);
    assert.throws(
      () => validarProveedor({ nombre: '  ' }, undefined, AHORA),
      /necesita un nombre/
    );
  });

  it('conserva el id previo aunque cambie el nombre', () => {
    const previa = proveedor('Vanguardia', { id: 'vanguardia' });
    const p = validarProveedor(
      { id: 'vanguardia', nombre: 'Grupo Vanguardia', activa: false },
      previa,
      '2026-09-22T00:00:00.000Z'
    );
    assert.equal(p.id, 'vanguardia');
    assert.equal(p.activa, false);
    assert.equal(p.actualizadoEn, '2026-09-22T00:00:00.000Z');
  });

  it('sin cambios conserva la fecha de la ultima edicion', () => {
    const previa = PROVEEDORES_INICIALES[0] as Proveedor;
    const p = validarProveedor({ ...previa }, previa, AHORA, 0);
    assert.equal(p.actualizadoEn, previa.actualizadoEn);
  });

  it('rechaza un color que no sea un nombre', () => {
    assert.throws(
      () => validarProveedor({ nombre: 'X', color: 'red;' }, undefined, AHORA),
      /color/
    );
  });
});

describe('validarCatalogoProveedores', () => {
  it('no deja dos proveedores con el mismo nombre, sin importar mayusculas ni acentos', () => {
    assert.throws(
      () =>
        validarCatalogoProveedores(
          [{ nombre: 'Vanguardia' }, { nombre: 'vanguárdia' }],
          [],
          AHORA
        ),
      /mismo proveedor/
    );
  });

  it('numera el orden como viene y evita ids repetidos', () => {
    const lista = validarCatalogoProveedores(
      [{ nombre: 'Total One' }, { nombre: 'Total-One!' }],
      [],
      AHORA
    );
    assert.deepEqual(
      lista.map((p) => [p.id, p.orden]),
      [
        ['total-one', 0],
        ['total-one-2', 1]
      ]
    );
  });
});

describe('contextoProveedores y opcionesProveedor', () => {
  it('arma la frase con los tres iniciales', () => {
    assert.equal(
      contextoProveedores(PROVEEDORES_INICIALES),
      'Los clientes y proveedores externos son tres: Vanguardia (grupo automotriz), Birdom (operaciones y producto) y AutoDeal (agencias automotrices).'
    );
    assert.equal(
      opcionesProveedor(PROVEEDORES_INICIALES),
      'Vanguardia|Birdom|AutoDeal|null'
    );
  });

  it('omite los inactivos y respeta el orden', () => {
    const lista = [
      proveedor('B', { orden: 2 }),
      proveedor('A', { orden: 1, descripcion: 'el primero' }),
      proveedor('C', { orden: 3, activa: false })
    ];
    assert.equal(
      contextoProveedores(lista),
      'Los clientes y proveedores externos son dos: B y A (el primero).'
    );
    assert.equal(opcionesProveedor(lista), 'B|A|null');
  });

  it('con uno solo o ninguno no habla de lista', () => {
    assert.match(
      contextoProveedores([proveedor('Solo', { descripcion: 'x' })]),
      /^El cliente o proveedor externo es Solo \(x\)\./
    );
    assert.match(
      contextoProveedores([]),
      /^No hay clientes ni proveedores externos capturados\./
    );
  });
});

describe('proveedorValido', () => {
  it('devuelve el nombre del catalogo y tolera mayusculas', () => {
    assert.equal(
      proveedorValido('vanguardia', PROVEEDORES_INICIALES),
      'Vanguardia'
    );
    assert.equal(
      proveedorValido('Total One', PROVEEDORES_INICIALES),
      undefined
    );
    assert.equal(proveedorValido(null, PROVEEDORES_INICIALES), undefined);
  });
});

describe('proveedorPorPalabra', () => {
  it('reconoce los tres de siempre como antes', () => {
    assert.equal(
      proveedorPorPalabra('alta de Vanguardia', PROVEEDORES_INICIALES),
      'Vanguardia'
    );
    assert.equal(
      proveedorPorPalabra('lo de birdom va urgente', PROVEEDORES_INICIALES),
      'Birdom'
    );
    assert.equal(
      proveedorPorPalabra('portal de AutoDeal', PROVEEDORES_INICIALES),
      'AutoDeal'
    );
    assert.equal(
      proveedorPorPalabra('sin pista', PROVEEDORES_INICIALES),
      undefined
    );
  });

  it('reconoce un proveedor nuevo por su nombre completo', () => {
    const lista = [
      ...PROVEEDORES_INICIALES,
      proveedor('Total One', { orden: 9 })
    ];
    assert.equal(
      proveedorPorPalabra('el CRM de total one', lista),
      'Total One'
    );
  });

  it('una primera palabra generica no etiqueta sola; el nombre completo si', () => {
    const lista = [
      ...PROVEEDORES_INICIALES,
      proveedor('Grupo Acme', { orden: 9 }),
      proveedor('AutoScope', { orden: 10 })
    ];
    assert.equal(
      proveedorPorPalabra('revisar el auto de la agencia', lista),
      undefined
    );
    assert.equal(
      proveedorPorPalabra('junta con el grupo de ventas', lista),
      undefined
    );
    assert.equal(
      proveedorPorPalabra('alta en grupo acme', lista),
      'Grupo Acme'
    );
    assert.equal(
      proveedorPorPalabra('demo de AutoScope el lunes', lista),
      'AutoScope'
    );
  });
});

describe('renombrarProveedor', () => {
  it('reetiqueta correo, personales y anotaciones, y deja lo demas igual', () => {
    const datos = {
      registroCorreo: {
        'correo-dealer': [tarea('a', 'Vanguardia'), tarea('b', 'Birdom')],
        'correo-itech': [tarea('c', 'Birdom')]
      },
      anotaciones: {
        a: { comentarios: [], actualizadoEn: AHORA },
        b: {
          comentarios: [],
          cambios: { project: 'vanguardia', title: 'Otro' },
          actualizadoEn: AHORA
        }
      },
      personales: [tarea('p', 'Vanguardia'), tarea('q', undefined)]
    };
    const { datos: nuevos, tocados } = renombrarProveedor(
      datos,
      'Vanguardia',
      'Grupo Vanguardia'
    );
    assert.equal(tocados, 3);
    assert.equal(
      nuevos.registroCorreo['correo-dealer']?.[0]?.project,
      'Grupo Vanguardia'
    );
    assert.equal(
      nuevos.registroCorreo['correo-dealer']?.[1]?.project,
      'Birdom'
    );
    assert.equal(
      nuevos.registroCorreo['correo-itech'],
      datos.registroCorreo['correo-itech']
    );
    assert.equal(nuevos.anotaciones['b']?.cambios?.project, 'Grupo Vanguardia');
    assert.equal(nuevos.anotaciones['b']?.cambios?.title, 'Otro');
    assert.equal(nuevos.anotaciones['a'], datos.anotaciones['a']);
    assert.equal(nuevos.personales[0]?.project, 'Grupo Vanguardia');
    assert.equal(nuevos.personales[1]?.project, undefined);
    assert.equal(
      datos.registroCorreo['correo-dealer']?.[0]?.project,
      'Vanguardia'
    );
  });

  it('sin coincidencias devuelve los mismos objetos', () => {
    const datos = {
      registroCorreo: { c: [tarea('a', 'Birdom')] },
      anotaciones: {},
      personales: []
    };
    const { datos: nuevos, tocados } = renombrarProveedor(
      datos,
      'Nada',
      'Otra'
    );
    assert.equal(tocados, 0);
    assert.equal(nuevos.registroCorreo, datos.registroCorreo);
    assert.equal(nuevos.anotaciones, datos.anotaciones);
    assert.equal(nuevos.personales, datos.personales);
  });
});

describe('pendientesAbiertosDeProveedor', () => {
  it('cuenta solo los no hechos de ese proveedor', () => {
    const lista = [
      tarea('a', 'Vanguardia'),
      tarea('b', 'vanguardia', 'en_progreso'),
      tarea('c', 'Vanguardia', 'hecho'),
      tarea('d', 'Birdom')
    ];
    assert.equal(pendientesAbiertosDeProveedor('Vanguardia', lista), 2);
    assert.equal(pendientesAbiertosDeProveedor('Total One', lista), 0);
  });
});
