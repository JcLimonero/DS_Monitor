import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { empresaDeRuta } from './empresas-rag.js';

describe('empresa de una ruta de Drive', () => {
  it('sale de la carpeta de la empresa, con o sin Empresas/ al inicio', () => {
    for (const [ruta, esperada] of [
      [
        'Empresas/Dealer Solutions/Cliente/Proyecto/02_Proyecto/a.md',
        'dealer-solutions'
      ],
      ['Empresas/Itech Dev/TPI/02_Proyecto/Juntas/a.md', 'itech-dev'],
      ['Empresas\\Operativ AI\\Cliente\\a.md', 'operativai'],
      ['empresas/nexus q tech/Cliente/a.md', 'nexusqtech'],
      ['Dealer Solutions/Cliente/02_Proyecto/a.md', 'dealer-solutions'],
      ['Mi unidad/Empresas/Itech Dev/Cliente/a.md', 'itech-dev']
    ] as const) {
      assert.equal(empresaDeRuta(ruta), esperada, ruta);
    }
  });

  it('usa el catalogo de empresas', () => {
    assert.equal(
      empresaDeRuta('Empresas/Mi Empresa Nueva/Cliente/a.md', [
        { id: 'mi-empresa-nueva', nombre: 'Mi Empresa Nueva' }
      ]),
      'mi-empresa-nueva'
    );
  });

  it('una carpeta de cliente o de proyecto con nombre de empresa no la promueve', () => {
    for (const ruta of [
      'Empresas/_POR_CLASIFICAR/Operativ/nota.md',
      'Empresas/_Historico/Cliente X/Nexus/a.md',
      'Empresas/Grupo Nuevo/Dealer/02_Proyecto/a.md',
      'Empresas/Integraciones/Itech Dev/a.md',
      'Empresas/Cliente Suelto/Itech/a.md',
      'Otros/Dealer Solutions/a.md'
    ]) {
      assert.equal(empresaDeRuta(ruta), undefined, ruta);
    }
  });

  it('una ruta vacia o solo de Empresas/ no tiene empresa', () => {
    for (const ruta of [undefined, '', '   ', 'Empresas', 'Empresas/']) {
      assert.equal(empresaDeRuta(ruta), undefined, String(ruta));
    }
  });
});
