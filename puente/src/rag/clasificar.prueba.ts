import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clasificarSensibilidad } from './clasificar.js';

const BASE = 'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal';

describe('clasificar sensibilidad', () => {
  it('una carpeta 04_Costos o 01_Cotizaciones en cualquier nivel marca costos', () => {
    for (const ruta of [
      `${BASE}/04_Costos/lista.md`,
      `${BASE}/01_Cotizaciones/2026-10/COT-1.md`,
      `${BASE}/01_Cotizaciones/_OBSOLETAS/COT-0.md`,
      `${BASE}/02_Proyecto/04_Costos/margen.md`,
      '04_Costos/lista.md'
    ]) {
      assert.equal(clasificarSensibilidad({ ruta }), 'costos', ruta);
    }
  });

  it('compara con la misma norma que el resto del RAG', () => {
    for (const ruta of [
      `${BASE}/04 costos/a.md`,
      `${BASE}/04-Costos/a.md`,
      `${BASE}/04_COSTOS/a.md`,
      `${BASE}/ 04_Costos /a.md`,
      `${BASE}/01_COTIZACIONES/a.md`,
      `Empresas\\Dealer Solutions\\Cliente\\Proyecto\\04_Costos\\a.md`
    ]) {
      assert.equal(clasificarSensibilidad({ ruta }), 'costos', ruta);
    }
  });

  it('las demas carpetas de etapa son generales', () => {
    for (const ruta of [
      `${BASE}/02_Proyecto/alcance.md`,
      `${BASE}/02_Proyecto/Juntas/2026-10-06_revision.md`,
      `${BASE}/03_Entregables/manual.md`,
      `${BASE}/PROYECTO_Portal.md`,
      'Empresas/Dealer Solutions/Grupo Norte/CLIENTE.md'
    ]) {
      assert.equal(clasificarSensibilidad({ ruta }), 'general', ruta);
    }
  });

  it('un nombre parecido no es la carpeta de costos', () => {
    for (const ruta of [
      `${BASE}/Costos/a.md`,
      `${BASE}/04_Costos_viejos/a.md`,
      `${BASE}/Cotizaciones/a.md`
    ]) {
      assert.equal(clasificarSensibilidad({ ruta }), 'general', ruta);
    }
  });

  it('el frontmatter sensibilidad: costos marca costos sin importar mayusculas', () => {
    const ruta = `${BASE}/02_Proyecto/ficha.md`;
    for (const valor of ['costos', 'Costos', 'COSTOS', '  costos  ']) {
      assert.equal(
        clasificarSensibilidad({ ruta, frontmatter: { sensibilidad: valor } }),
        'costos',
        valor
      );
    }
    assert.equal(
      clasificarSensibilidad({ ruta, frontmatter: { Sensibilidad: 'costos' } }),
      'costos'
    );
  });

  it('un valor que no es general ni costos falla cerrado', () => {
    const ruta = `${BASE}/02_Proyecto/ficha.md`;
    for (const valor of [
      'secreto',
      'generales',
      '',
      '   ',
      '[general]',
      'general # revisar',
      'costos,general'
    ]) {
      assert.equal(
        clasificarSensibilidad({ ruta, frontmatter: { sensibilidad: valor } }),
        'costos',
        JSON.stringify(valor)
      );
    }
    for (const valor of [true, 0, null, ['general'], { a: 1 }]) {
      assert.equal(
        clasificarSensibilidad({ ruta, frontmatter: { sensibilidad: valor } }),
        'costos',
        JSON.stringify(valor)
      );
    }
  });

  it('si el frontmatter repite la llave con otra grafia, basta una que no sea general', () => {
    assert.equal(
      clasificarSensibilidad({
        ruta: `${BASE}/02_Proyecto/ficha.md`,
        frontmatter: { sensibilidad: 'general', SENSIBILIDAD: 'costos' }
      }),
      'costos'
    );
  });

  it('general en el frontmatter no baja un documento de costos', () => {
    for (const valor of ['general', 'General', 'GENERAL']) {
      assert.equal(
        clasificarSensibilidad({
          ruta: `${BASE}/04_Costos/lista.md`,
          frontmatter: { sensibilidad: valor }
        }),
        'costos'
      );
      assert.equal(
        clasificarSensibilidad({
          ruta: `${BASE}/01_Cotizaciones/COT-1.md`,
          frontmatter: { sensibilidad: valor }
        }),
        'costos'
      );
    }
  });

  it('general en el frontmatter, en una ruta normal, es general', () => {
    assert.equal(
      clasificarSensibilidad({
        ruta: `${BASE}/02_Proyecto/ficha.md`,
        frontmatter: { sensibilidad: 'General' }
      }),
      'general'
    );
    assert.equal(
      clasificarSensibilidad({
        ruta: `${BASE}/02_Proyecto/ficha.md`,
        frontmatter: { cliente: 'Taller Norte' }
      }),
      'general'
    );
  });

  it('sin ruta queda como costos, aunque el frontmatter diga general', () => {
    assert.equal(clasificarSensibilidad({}), 'costos');
    assert.equal(clasificarSensibilidad({ ruta: undefined }), 'costos');
    assert.equal(clasificarSensibilidad({ ruta: '' }), 'costos');
    assert.equal(clasificarSensibilidad({ ruta: '   ' }), 'costos');
    assert.equal(clasificarSensibilidad({ ruta: '//' }), 'costos');
    assert.equal(
      clasificarSensibilidad({ frontmatter: { sensibilidad: 'general' } }),
      'costos'
    );
  });
});
