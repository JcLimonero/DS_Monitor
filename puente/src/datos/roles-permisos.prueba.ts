import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buscarUsuarioPorCorreo,
  camposOcultos,
  clienteEnAlcance,
  esDirector,
  ocultarCostosCotizacion,
  permisosEfectivos,
  proyectoEnAlcance,
  ROL_COMERCIAL,
  ROL_DESARROLLO,
  ROL_DIRECTOR,
  ROL_FINANZAS,
  ROLES_FABRICA,
  tienePermiso,
  validarRol,
  validarUsuarioCrm
} from './roles-permisos.js';
import type { RolCrm, UsuarioCrm } from '../nucleo/contrato.js';

describe('roles-permisos', () => {
  describe('roles de fabrica', () => {
    it('tiene 4 roles de fabrica', () => {
      assert.equal(ROLES_FABRICA.length, 4);
    });

    it('Director tiene acceso completo', () => {
      assert.equal(ROL_DIRECTOR.permisos['configuracion'], 'escritura');
      assert.equal(ROL_DIRECTOR.permisos['licencias'], 'escritura');
      assert.equal(ROL_DIRECTOR.permisos['clientes'], 'escritura');
    });

    it('Finanzas tiene acceso a costos pero no a configuracion', () => {
      assert.equal(ROL_FINANZAS.permisos['costos'], 'lectura');
      assert.equal(ROL_FINANZAS.permisos['cobranza'], 'escritura');
      assert.equal(ROL_FINANZAS.permisos['configuracion'], undefined);
    });

    it('Comercial no tiene acceso a costos', () => {
      assert.equal(ROL_COMERCIAL.permisos['costos'], undefined);
      assert.equal(ROL_COMERCIAL.permisos['clientes'], 'escritura');
    });

    it('Desarrollo solo tiene acceso a proyectos y desarrollo', () => {
      assert.equal(ROL_DESARROLLO.permisos['desarrollo'], 'escritura');
      assert.equal(ROL_DESARROLLO.permisos['proyectos'], 'lectura');
      assert.equal(ROL_DESARROLLO.permisos['cotizaciones'], undefined);
    });
  });

  describe('validarRol', () => {
    it('valida un rol basico', () => {
      const rol = validarRol(
        { nombre: 'Prueba', permisos: { clientes: 'lectura' } },
        undefined,
        '2026-01-01T00:00:00Z'
      );
      assert.equal(rol.nombre, 'Prueba');
      assert.equal(rol.id, 'prueba');
      assert.equal(rol.permisos['clientes'], 'lectura');
      assert.equal(rol.esSistema, false);
    });

    it('rechaza area invalida', () => {
      assert.throws(
        () =>
          validarRol(
            { nombre: 'Malo', permisos: { inventada: 'lectura' } },
            undefined,
            '2026-01-01T00:00:00Z'
          ),
        /no es válida/
      );
    });

    it('rechaza nivel invalido', () => {
      assert.throws(
        () =>
          validarRol(
            { nombre: 'Malo', permisos: { clientes: 'superadmin' } },
            undefined,
            '2026-01-01T00:00:00Z'
          ),
        /no es válido/
      );
    });
  });

  describe('validarUsuarioCrm', () => {
    it('valida un usuario basico', () => {
      const usuario = validarUsuarioCrm(
        {
          nombre: 'Ana García',
          correo: 'ana@example.com',
          roles: ['comercial']
        },
        undefined,
        '2026-01-01T00:00:00Z'
      );
      assert.equal(usuario.nombre, 'Ana García');
      assert.equal(usuario.correo, 'ana@example.com');
      assert.deepEqual(usuario.roles, ['comercial']);
      assert.equal(usuario.activo, true);
    });

    it('normaliza el correo a minusculas', () => {
      const usuario = validarUsuarioCrm(
        { nombre: 'Test', correo: 'ANA@Example.COM', roles: [] },
        undefined,
        '2026-01-01T00:00:00Z'
      );
      assert.equal(usuario.correo, 'ana@example.com');
    });

    it('rechaza correo invalido', () => {
      assert.throws(
        () =>
          validarUsuarioCrm(
            { nombre: 'Test', correo: 'no-es-correo', roles: [] },
            undefined,
            '2026-01-01T00:00:00Z'
          ),
        /no es válido/
      );
    });

    it('acepta alcance por proyectos', () => {
      const usuario = validarUsuarioCrm(
        {
          nombre: 'Dev',
          correo: 'dev@example.com',
          roles: ['desarrollo'],
          alcance: { proyectos: ['proy-1', 'proy-2'] }
        },
        undefined,
        '2026-01-01T00:00:00Z'
      );
      assert.deepEqual(usuario.alcance?.proyectos, ['proy-1', 'proy-2']);
    });
  });

  describe('permisosEfectivos', () => {
    const roles: RolCrm[] = ROLES_FABRICA;

    it('Director tiene todos los permisos', () => {
      const usuario: UsuarioCrm = {
        id: 'u1',
        correo: 'carlos@example.com',
        nombre: 'Carlos',
        roles: ['director'],
        activo: true,
        actualizadoEn: '2026-01-01T00:00:00Z'
      };
      const permisos = permisosEfectivos(usuario, roles);
      assert.equal(permisos['configuracion'], 'escritura');
      assert.equal(permisos['licencias'], 'escritura');
    });

    it('usuario inactivo no tiene permisos', () => {
      const usuario: UsuarioCrm = {
        id: 'u2',
        correo: 'ex@example.com',
        nombre: 'Ex',
        roles: ['director'],
        activo: false,
        actualizadoEn: '2026-01-01T00:00:00Z'
      };
      const permisos = permisosEfectivos(usuario, roles);
      assert.equal(permisos['configuracion'], 'ninguno');
    });

    it('combina permisos de varios roles', () => {
      const usuario: UsuarioCrm = {
        id: 'u3',
        correo: 'multi@example.com',
        nombre: 'Multi',
        roles: ['comercial', 'finanzas'],
        activo: true,
        actualizadoEn: '2026-01-01T00:00:00Z'
      };
      const permisos = permisosEfectivos(usuario, roles);
      assert.equal(permisos['clientes'], 'escritura');
      assert.equal(permisos['costos'], 'lectura');
      assert.equal(permisos['cobranza'], 'escritura');
    });

    it('toma el nivel mas alto entre roles', () => {
      const rolLectura: RolCrm = {
        id: 'lector',
        nombre: 'Lector',
        permisos: { clientes: 'lectura' },
        esSistema: false,
        actualizadoEn: '2026-01-01T00:00:00Z'
      };
      const rolEscritura: RolCrm = {
        id: 'editor',
        nombre: 'Editor',
        permisos: { clientes: 'escritura' },
        esSistema: false,
        actualizadoEn: '2026-01-01T00:00:00Z'
      };
      const usuario: UsuarioCrm = {
        id: 'u4',
        correo: 'mix@example.com',
        nombre: 'Mix',
        roles: ['lector', 'editor'],
        activo: true,
        actualizadoEn: '2026-01-01T00:00:00Z'
      };
      const permisos = permisosEfectivos(usuario, [rolLectura, rolEscritura]);
      assert.equal(permisos['clientes'], 'escritura');
    });
  });

  describe('tienePermiso', () => {
    it('lectura cumple lectura', () => {
      const permisos = { clientes: 'lectura' as const };
      assert.equal(
        tienePermiso(permisos as never, 'clientes', 'lectura'),
        true
      );
    });

    it('escritura cumple lectura', () => {
      const permisos = { clientes: 'escritura' as const };
      assert.equal(
        tienePermiso(permisos as never, 'clientes', 'lectura'),
        true
      );
    });

    it('lectura no cumple escritura', () => {
      const permisos = { clientes: 'lectura' as const };
      assert.equal(
        tienePermiso(permisos as never, 'clientes', 'escritura'),
        false
      );
    });
  });

  describe('esDirector', () => {
    it('detecta Director por acceso a areas exclusivas', () => {
      const permisos = permisosEfectivos(
        {
          id: 'u1',
          correo: 'carlos@example.com',
          nombre: 'Carlos',
          roles: ['director'],
          activo: true,
          actualizadoEn: '2026-01-01T00:00:00Z'
        },
        ROLES_FABRICA
      );
      assert.equal(esDirector(permisos), true);
    });

    it('Comercial no es Director', () => {
      const permisos = permisosEfectivos(
        {
          id: 'u2',
          correo: 'ventas@example.com',
          nombre: 'Ventas',
          roles: ['comercial'],
          activo: true,
          actualizadoEn: '2026-01-01T00:00:00Z'
        },
        ROLES_FABRICA
      );
      assert.equal(esDirector(permisos), false);
    });
  });

  describe('filtrado por alcance', () => {
    it('sin alcance ve todo', () => {
      assert.equal(
        proyectoEnAlcance('proy-1', 'cli-1', 'emp-1', undefined),
        true
      );
      assert.equal(clienteEnAlcance('cli-1', undefined), true);
    });

    it('alcance por proyecto', () => {
      const alcance = { proyectos: ['proy-1'] };
      assert.equal(
        proyectoEnAlcance('proy-1', 'cli-1', 'emp-1', alcance),
        true
      );
      assert.equal(
        proyectoEnAlcance('proy-2', 'cli-1', 'emp-1', alcance),
        false
      );
    });

    it('alcance por cliente', () => {
      const alcance = { clientes: ['cli-1'] };
      assert.equal(
        proyectoEnAlcance('proy-1', 'cli-1', 'emp-1', alcance),
        true
      );
      assert.equal(
        proyectoEnAlcance('proy-2', 'cli-2', 'emp-1', alcance),
        false
      );
      assert.equal(clienteEnAlcance('cli-1', alcance), true);
      assert.equal(clienteEnAlcance('cli-2', alcance), false);
    });

    it('alcance por empresa', () => {
      const alcance = { empresas: ['dealer-solutions'] };
      assert.equal(
        proyectoEnAlcance('proy-1', 'cli-1', 'dealer-solutions', alcance),
        true
      );
      assert.equal(
        proyectoEnAlcance('proy-2', 'cli-2', 'nexusqtech', alcance),
        false
      );
    });
  });

  describe('ocultarCostos', () => {
    it('oculta costos si no tiene permiso', () => {
      const cotizacion = { id: '1', subtotal: 100, iva: 16, total: 116 };
      const ocultos = camposOcultos({
        costos: 'ninguno',
        cobranza: 'ninguno'
      } as never);
      const resultado = ocultarCostosCotizacion(cotizacion, ocultos);
      assert.equal('subtotal' in resultado, false);
      assert.equal('iva' in resultado, false);
      assert.equal('total' in resultado, false);
      assert.equal(resultado.id, '1');
    });

    it('no oculta si tiene permiso', () => {
      const cotizacion = { id: '1', subtotal: 100, iva: 16, total: 116 };
      const ocultos = camposOcultos({
        costos: 'lectura',
        cobranza: 'lectura'
      } as never);
      const resultado = ocultarCostosCotizacion(cotizacion, ocultos);
      assert.equal(resultado.subtotal, 100);
      assert.equal(resultado.total, 116);
    });
  });

  describe('buscarUsuarioPorCorreo', () => {
    const usuarios: UsuarioCrm[] = [
      {
        id: 'u1',
        correo: 'ana@example.com',
        nombre: 'Ana',
        roles: ['comercial'],
        activo: true,
        actualizadoEn: '2026-01-01T00:00:00Z'
      },
      {
        id: 'u2',
        correo: 'beto@example.com',
        nombre: 'Beto',
        roles: ['desarrollo'],
        activo: false,
        actualizadoEn: '2026-01-01T00:00:00Z'
      }
    ];

    it('encuentra usuario activo', () => {
      const encontrado = buscarUsuarioPorCorreo('ana@example.com', usuarios);
      assert.equal(encontrado?.nombre, 'Ana');
    });

    it('no encuentra usuario inactivo', () => {
      const encontrado = buscarUsuarioPorCorreo('beto@example.com', usuarios);
      assert.equal(encontrado, undefined);
    });

    it('no encuentra usuario inexistente', () => {
      const encontrado = buscarUsuarioPorCorreo('otro@example.com', usuarios);
      assert.equal(encontrado, undefined);
    });

    it('normaliza mayusculas', () => {
      const encontrado = buscarUsuarioPorCorreo('ANA@Example.COM', usuarios);
      assert.equal(encontrado?.nombre, 'Ana');
    });
  });
});
