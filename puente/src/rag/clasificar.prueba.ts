import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clasificarSensibilidad,
  declaracionDeSensibilidad
} from './clasificar.js';

const BASE = 'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal';

function costos(ruta: string | undefined, markdown?: string): void {
  assert.equal(clasificarSensibilidad({ ruta, markdown }), 'costos', ruta);
}

function general(ruta: string | undefined, markdown?: string): void {
  assert.equal(clasificarSensibilidad({ ruta, markdown }), 'general', ruta);
}

const CUERPO = '# Titulo\n\n## Resumen\n\nTexto.\n';

describe('clasificar sensibilidad: lista blanca', () => {
  it('solo Juntas, 02_Proyecto y 03_Entregables son generales', () => {
    general(`${BASE}/02_Proyecto/alcance.md`);
    general(`${BASE}/02_Proyecto/Juntas/2026-10-06_revision.md`);
    general(`${BASE}/03_Entregables/manual.md`);
    general(`${BASE}/Juntas/2026-10-06_revision.md`);
    general(
      'Empresas/Itech Dev/TPI Composites/02_Proyecto/Juntas/2026-10-06_facturacion.md'
    );
    general(`${BASE}/02_Proyecto/diseno/pantallas/inicio.md`);
  });

  it('todo lo que no cuelga de la lista blanca es costos', () => {
    for (const ruta of [
      'Empresas/Dealer Solutions/Grupo Norte/CLIENTE.md',
      `${BASE}/CLIENTE.md`,
      `${BASE}/PROYECTO_Portal.md`,
      `${BASE}/notas.md`,
      `${BASE}/Documentos/acta.md`,
      'Empresas/Dealer Solutions/00_Brand_Kit/BRAND.md',
      'Empresas/Dealer Solutions/Integraciones/Proveedor/ficha.md',
      'Empresas/Dealer Solutions/Interno/Politicas/politica.md',
      'Empresas/_POR_CLASIFICAR/suelto.md',
      'Empresas/Dealer Solutions/_Historico/Cliente/Viejo/nota.md',
      'suelto.md'
    ]) {
      costos(ruta);
    }
  });

  it('el nombre del archivo no cuenta como carpeta de la lista blanca', () => {
    costos(`${BASE}/Juntas`);
    costos(`${BASE}/notas/02_Proyecto`);
    costos(`${BASE}/Juntas.md`);
  });

  it('sin ruta es costos, tambien con sensibilidad: general', () => {
    costos(undefined);
    costos('');
    costos('   ');
    costos('//');
    costos(undefined, `---\nsensibilidad: general\n---\n${CUERPO}`);
  });
});

describe('clasificar sensibilidad: carpetas de costos (nadie las baja)', () => {
  it('un segmento 04_Costos o 01_Cotizaciones en cualquier nivel es costos', () => {
    for (const ruta of [
      `${BASE}/04_Costos/lista.md`,
      `${BASE}/01_Cotizaciones/2026-10/COT-1.md`,
      `${BASE}/01_Cotizaciones/_OBSOLETAS/COT-0.md`,
      `${BASE}/02_Proyecto/04_Costos/margen.md`,
      `${BASE}/Juntas/01_Cotizaciones/acta.md`,
      '04_Costos/lista.md'
    ]) {
      costos(ruta);
    }
  });

  it('compara con la norma del RAG: mayusculas, acentos, separadores y espacios', () => {
    for (const ruta of [
      `${BASE}/04 costos/a.md`,
      `${BASE}/04-Costos/a.md`,
      `${BASE}/04 - Costos/a.md`,
      `${BASE}/04_COSTOS/a.md`,
      `${BASE}/ 04_Costos /a.md`,
      `${BASE}/04_Costos /a.md`,
      `${BASE}/01.Cotizaciones/a.md`,
      `${BASE}/01_COTIZACIONES/a.md`,
      `${BASE}/01 - Cotizaciónes/a.md`,
      'Empresas\\Dealer Solutions\\Cliente\\Proyecto\\04_Costos\\a.md'
    ]) {
      costos(ruta);
    }
  });

  it('ningun sensibilidad: general baja un documento de esas carpetas', () => {
    for (const valor of ['general', 'General', 'GENERAL', '"general"']) {
      const md = `---\nsensibilidad: ${valor}\n---\n${CUERPO}`;
      costos(`${BASE}/04_Costos/lista.md`, md);
      costos(`${BASE}/01_Cotizaciones/COT-1.md`, md);
      costos(`${BASE}/02_Proyecto/04_Costos/lista.md`, md);
    }
  });
});

describe('clasificar sensibilidad: capa de nombres de precios', () => {
  it('carpetas viejas o sin numero con nombre de precios son costos', () => {
    for (const carpeta of [
      'Cotizaciones',
      '1_Cotizaciones',
      '01_Cotizacion',
      '01_Cotizaciones_2025',
      '01_Cotizaciones 2025',
      'Costos',
      '04_Costo',
      'Precios',
      'Lista de precios',
      'Presupuestos',
      'Propuesta Económica',
      'Propuesta_economica'
    ]) {
      costos(`${BASE}/${carpeta}/a.md`);
      costos(`${BASE}/02_Proyecto/${carpeta}/a.md`);
      costos(`${BASE}/03_Entregables/${carpeta}/a.md`);
    }
  });

  it('un archivo con nombre de precios es costos aunque cuelgue de la lista blanca', () => {
    for (const ruta of [
      `${BASE}/02_Proyecto/COTIZACION_x.md`,
      `${BASE}/02_Proyecto/cotizacion-portal.md`,
      `${BASE}/03_Entregables/Propuesta_economica.md`,
      `${BASE}/03_Entregables/Propuesta Económica v2.md`,
      `${BASE}/02_Proyecto/PropuestaEconomica.md`,
      `${BASE}/02_Proyecto/Presupuesto_final.md`,
      `${BASE}/02_Proyecto/lista_de_precios.md`,
      `${BASE}/02_Proyecto/costos-mensuales.md`,
      `${BASE}/Juntas/2026-10-06_revision_de_precios.md`
    ]) {
      costos(ruta);
    }
  });

  it('un nombre sin esas raices sigue siendo general en la lista blanca', () => {
    general(`${BASE}/02_Proyecto/propuesta_tecnica.md`);
    general(`${BASE}/03_Entregables/manual_de_usuario.md`);
  });

  it('sensibilidad: general explicito anula esta capa, no la de las carpetas de costos', () => {
    const md = `---\nsensibilidad: general\n---\n${CUERPO}`;
    general(`${BASE}/02_Proyecto/COTIZACION_x.md`, md);
    general(`${BASE}/03_Entregables/Propuesta_economica.md`, md);
    general(`${BASE}/Cotizaciones/resumen.md`, md);
    costos(`${BASE}/04_Costos/Propuesta_economica.md`, md);
    costos(`${BASE}/01_Cotizaciones/resumen.md`, md);
  });
});

describe('clasificar sensibilidad: lo declarado en el texto', () => {
  const RUTA = `${BASE}/02_Proyecto/ficha.md`;

  it('una ficha con sensibilidad: general fuera de la lista blanca es general', () => {
    general(
      `${BASE}/PROYECTO_Portal.md`,
      `---\nsensibilidad: general\n---\n${CUERPO}`
    );
    general(
      'Empresas/Dealer Solutions/Grupo Norte/CLIENTE.md',
      `---\nsensibilidad: General\n---\n${CUERPO}`
    );
  });

  it('sensibilidad: costos, o cualquier valor que no sea general, es costos', () => {
    for (const valor of [
      'costos',
      'Costos',
      'COSTOS',
      'secreto',
      'generales',
      '',
      '   ',
      '[general]',
      'general # revisar',
      'costos,general',
      'general general'
    ]) {
      costos(RUTA, `---\nsensibilidad: ${valor}\n---\n${CUERPO}`);
    }
  });

  it('quita comillas y espacios al leer general', () => {
    for (const valor of ['general', ' general ', '"general"', "'General'"]) {
      general(RUTA, `---\nsensibilidad: ${valor}\n---\n${CUERPO}`);
    }
  });
});

describe('declaracion de sensibilidad en el texto crudo', () => {
  const declara = (texto: string) => declaracionDeSensibilidad(texto);

  it('sin la llave no declara nada', () => {
    assert.equal(declara(CUERPO), 'ninguna');
    assert.equal(declara(''), 'ninguna');
    assert.equal(declaracionDeSensibilidad(undefined), 'ninguna');
    assert.equal(declara(`---\ncliente: Norte\n---\n${CUERPO}`), 'ninguna');
  });

  it('una sola llave general se acepta, con cualquier grafia', () => {
    for (const linea of [
      'sensibilidad: general',
      'Sensibilidad: General',
      'SENSIBILIDAD: GENERAL',
      '  sensibilidad : general',
      '"sensibilidad": "general"',
      "'sensibilidad':'general'",
      'sensibilidad:general'
    ]) {
      assert.equal(declara(`---\n${linea}\n---\n${CUERPO}`), 'general', linea);
    }
  });

  it('una llave duplicada es otra, sin importar cual vaya primero', () => {
    assert.equal(
      declara('---\nsensibilidad: costos\nsensibilidad: general\n---\n'),
      'otra'
    );
    assert.equal(
      declara('---\nsensibilidad: general\nsensibilidad: costos\n---\n'),
      'otra'
    );
    assert.equal(
      declara('---\nsensibilidad: general\nSensibilidad: general\n---\n'),
      'otra'
    );
    assert.equal(
      declara('---\nsensibilidad: general\n---\n\nsensibilidad: general\n'),
      'otra'
    );
  });

  it('un valor vacio, una lista o algo distinto de general es otra', () => {
    for (const texto of [
      '---\nsensibilidad:\n---\n',
      '---\nsensibilidad: costos\n---\n',
      '---\nSensibilidad: COSTOS\n---\n',
      '---\nsensibilidad:\n  - general\n---\n',
      '---\nsensibilidad: [general]\n---\n',
      '---\nsensibilidad: "gen"\n---\n'
    ]) {
      assert.equal(declara(texto), 'otra', JSON.stringify(texto));
    }
  });

  it('lee la llave aunque el frontmatter este mal armado', () => {
    for (const [nombre, texto] of [
      ['no empieza en el byte 0', '\n\n---\nsensibilidad: costos\n---\n'],
      ['empieza con espacios', '  \n---\nsensibilidad: costos\n---\n'],
      ['cierra con puntos', '---\nsensibilidad: costos\n...\n# T\n'],
      ['no cierra', '---\nsensibilidad: costos\n# T\n\nTexto.\n'],
      ['bloque yaml', '```yaml\nsensibilidad: costos\n```\n# T\n'],
      ['con BOM', '﻿---\nsensibilidad: costos\n---\n'],
      ['solo CR', '---\rsensibilidad: costos\r---\r# T\r'],
      ['CRLF', '---\r\nsensibilidad: costos\r\n---\r\n# T\r\n'],
      ['llave en mayuscula', '---\nSensibilidad: costos\n---\n'],
      ['sin frontmatter', 'sensibilidad: costos\n# T\n']
    ] as const) {
      assert.equal(declara(texto), 'otra', nombre);
    }
  });

  it('una sola llave general tambien se lee con CR, CRLF, BOM o sin cierre', () => {
    for (const texto of [
      '---\rsensibilidad: general\r---\r# T\r',
      '---\r\nsensibilidad: general\r\n---\r\n# T\r\n',
      '﻿---\nsensibilidad: general\n---\n',
      '\n\n---\nsensibilidad: general\n',
      '```yaml\nsensibilidad: general\n```\n'
    ]) {
      assert.equal(declara(texto), 'general', JSON.stringify(texto));
    }
  });

  it('solo revisa las primeras 60 lineas', () => {
    const relleno = Array.from({ length: 59 }, (_, i) => `l${i}`).join('\n');
    assert.equal(declara(`${relleno}\nsensibilidad: costos\n`), 'otra');
    assert.equal(declara(`${relleno}\nx\nsensibilidad: costos\n`), 'ninguna');
  });

  it('un comentario no cuenta como llave', () => {
    assert.equal(declara('---\n# sensibilidad: costos\n---\n'), 'ninguna');
  });

  it('la llave repetida o rara pesa en la clasificacion completa', () => {
    const ruta = `${BASE}/02_Proyecto/ficha.md`;
    costos(
      ruta,
      '---\nsensibilidad: costos\nsensibilidad: general\n---\n' + CUERPO
    );
    costos(
      ruta,
      '---\nsensibilidad: general\nsensibilidad: costos\n---\n' + CUERPO
    );
    costos(ruta, `\n\n---\nsensibilidad: costos\n---\n${CUERPO}`);
    costos(ruta, `---\nsensibilidad: costos\n...\n${CUERPO}`);
    costos(ruta, `---\nsensibilidad: costos\n${CUERPO}`);
    costos(ruta, '```yaml\nsensibilidad: costos\n```\n' + CUERPO);
    costos(ruta, `---\rsensibilidad: costos\r---\r${CUERPO}`);
    costos(ruta, `---\nsensibilidad:\n---\n${CUERPO}`);
    costos(ruta, `---\nsensibilidad:\n  - general\n---\n${CUERPO}`);
    costos(ruta, `---\nSensibilidad: costos\n---\n${CUERPO}`);
  });
});
