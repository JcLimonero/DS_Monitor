import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PATRONES_DE_DINERO,
  RAICES_DE_COSTOS,
  clasificarSensibilidad,
  contieneCifrasDeDinero,
  declaracionDeSensibilidad
} from './clasificar.js';

const BASE = 'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal';
const FICHA = 'Empresas/Dealer Solutions/Grupo Norte/CLIENTE.md';

function costos(ruta: string | undefined, markdown?: string): void {
  assert.equal(clasificarSensibilidad({ ruta, markdown }), 'costos', ruta);
}

function general(ruta: string | undefined, markdown?: string): void {
  assert.equal(clasificarSensibilidad({ ruta, markdown }), 'general', ruta);
}

const CUERPO = '# Titulo\n\n## Resumen\n\nTexto.\n';

/** Un documento con frontmatter que declara la sensibilidad (y un cuerpo sin cifras). */
function con(linea: string, cuerpo = CUERPO): string {
  return `---\n${linea}\n---\n${cuerpo}`;
}

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
      FICHA,
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
    costos(undefined, con('sensibilidad: general'));
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
      const md = con(`sensibilidad: ${valor}`);
      costos(`${BASE}/04_Costos/lista.md`, md);
      costos(`${BASE}/01_Cotizaciones/COT-1.md`, md);
      costos(`${BASE}/02_Proyecto/04_Costos/lista.md`, md);
    }
  });
});

describe('clasificar sensibilidad: nombres de precios en la ruta', () => {
  it('las raices viven en una constante, sin duplicados', () => {
    assert.equal(new Set(RAICES_DE_COSTOS).size, RAICES_DE_COSTOS.length);
    for (const raiz of [
      'cotiza',
      'cost',
      'precio',
      'presupuest',
      'propuesta econom',
      'propuesta comercial',
      'tarifa',
      'honorario',
      'monto',
      'pago',
      'pricing',
      'price',
      'quote',
      'budget'
    ]) {
      assert.ok(RAICES_DE_COSTOS.includes(raiz), raiz);
    }
  });

  it('carpetas viejas, sin numero o en otro idioma con nombre de precios son costos', () => {
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
      'Propuesta_economica',
      'Propuesta Comercial',
      'Tarifas',
      'Honorarios',
      'Montos',
      'Plan de pagos',
      'Pricing',
      'Quotes',
      'Budget'
    ]) {
      costos(`${BASE}/${carpeta}/a.md`);
      costos(`${BASE}/02_Proyecto/${carpeta}/a.md`);
      costos(`${BASE}/03_Entregables/${carpeta}/a.md`);
      costos(`${BASE}/Juntas/${carpeta}/a.md`);
    }
  });

  it('un archivo con nombre de precios es costos aunque cuelgue de la lista blanca', () => {
    for (const nombre of [
      'COTIZACION_x.md',
      'cotizacion-portal.md',
      'Propuesta_economica.md',
      'Propuesta Económica v2.md',
      'PropuestaEconomica.md',
      'Propuesta_Comercial_v2.md',
      'PropuestaComercial.md',
      'Presupuesto_final.md',
      'lista_de_precios.md',
      'costos-mensuales.md',
      'Cost_breakdown.md',
      'Tarifas.md',
      'Honorarios.md',
      'Honorarios_2026.md',
      'Montos.md',
      'Plan_de_pagos.md',
      'Pricing.md',
      'Price_list.md',
      'Quote_x.md',
      'Budget.md',
      '2026-10-06_revision_de_precios.md'
    ]) {
      costos(`${BASE}/02_Proyecto/${nombre}`);
      costos(`${BASE}/03_Entregables/${nombre}`);
      costos(`${BASE}/Juntas/${nombre}`);
    }
  });

  it('un nombre sin esas raices sigue siendo general en la lista blanca', () => {
    general(`${BASE}/02_Proyecto/propuesta_tecnica.md`);
    general(`${BASE}/03_Entregables/manual_de_usuario.md`);
    general(`${BASE}/Juntas/2026-10-06_kickoff.md`);
  });

  it('sensibilidad: general valido anula esta capa, no la de las carpetas de costos', () => {
    const md = con('sensibilidad: general');
    general(`${BASE}/02_Proyecto/COTIZACION_x.md`, md);
    general(`${BASE}/03_Entregables/Propuesta_economica.md`, md);
    general(`${BASE}/02_Proyecto/Tarifas.md`, md);
    general(`${BASE}/Cotizaciones/resumen.md`, md);
    costos(`${BASE}/04_Costos/Propuesta_economica.md`, md);
    costos(`${BASE}/01_Cotizaciones/resumen.md`, md);
  });
});

describe('clasificar sensibilidad: cifras de dinero en el texto', () => {
  const junta = (frase: string) =>
    `# Revision\n\n## Resumen\n\nSe reviso el timbrado. ${frase}\n`;
  const RUTA_JUNTA = `${BASE}/Juntas/2026-10-06_revision.md`;

  it('los patrones viven en una constante exportada', () => {
    assert.ok(PATRONES_DE_DINERO.length >= 4);
    assert.ok(PATRONES_DE_DINERO.every((p) => p instanceof RegExp));
  });

  it('una junta con cifras de dinero es costos', () => {
    for (const frase of [
      'El proyecto cuesta $1,200.',
      'Quedo en $ 1200 al mes.',
      'Son $1 por licencia.',
      'Cobran US$ 500.',
      'El total es 15000 MXN.',
      'Pagan 2,000 mxn.',
      'Subtotal 100 USD',
      'usd 100',
      'Son 100 Eur.',
      'Se factura +IVA.',
      'Sale en 100 + IVA.',
      'Con IVA incluido.',
      'Con I.V.A. incluido.',
      'El campo total_mxn queda vacio.',
      'Son 1,200 pesos.',
      'Son 1200 pesos mensuales.',
      'Son 1.500 pesos.',
      'Cuesta 10 mil pesos.',
      'Cuesta 3 millones de pesos.',
      'Son 500 dólares.',
      'Son 500 dolares.',
      'Son 500 euros.',
      'Son 500 \u20AC.',
      '\u20AC 500.',
      '\uFF04\uFF11\uFF12\uFF10\uFF10'
    ]) {
      costos(RUTA_JUNTA, junta(frase));
    }
  });

  it('una junta sin cifras ni palabras de precios sigue siendo general', () => {
    general(RUTA_JUNTA, junta('Se acordo el alcance del modulo y la fecha.'));
    general(RUTA_JUNTA, CUERPO);
    for (const frase of [
      'Falta el $ de la celda.',
      'Cuesta $abc.',
      'Ivan y Ivana vieron Europa.',
      'Los pesos pesados y los dolares falsos.',
      'La version 2.0 sale el 5 de octubre a las 10:30.',
      'Son cmxn y usdx.',
      'Hay 5 reuniones.',
      'Llamar al 555-1234.'
    ]) {
      general(RUTA_JUNTA, junta(frase));
    }
  });

  it('las cifras tambien cuentan en los demas documentos de la lista blanca y en el frontmatter', () => {
    costos(`${BASE}/02_Proyecto/alcance.md`, junta('Total $500.'));
    costos(`${BASE}/03_Entregables/manual.md`, junta('Total 500 MXN.'));
    costos(`${BASE}/02_Proyecto/alcance.md`, con('monto: $500'));
  });

  it('sensibilidad: general valido libera un documento con cifras, salvo en las carpetas de costos', () => {
    const cifras = 'Presupuesto $5,000 MXN +IVA.';
    general(RUTA_JUNTA, con('sensibilidad: general', junta(cifras)));
    general(
      `${BASE}/PROYECTO_Portal.md`,
      con('sensibilidad: general', junta(cifras))
    );
    general(FICHA, con('sensibilidad: general', junta(cifras)));
    costos(
      `${BASE}/04_Costos/lista.md`,
      con('sensibilidad: general', junta(cifras))
    );
    costos(
      `${BASE}/01_Cotizaciones/lista.md`,
      con('sensibilidad: general', junta(cifras))
    );
  });

  it('contieneCifrasDeDinero responde sobre el texto plegado', () => {
    assert.equal(contieneCifrasDeDinero(undefined), false);
    assert.equal(contieneCifrasDeDinero(''), false);
    assert.equal(contieneCifrasDeDinero('sin cifras'), false);
    assert.equal(contieneCifrasDeDinero('Son 500 DÓLARES'), true);
    assert.equal(contieneCifrasDeDinero('Son 500 dólares'), true);
    assert.equal(contieneCifrasDeDinero('$\u200B1200'), true);
  });

  it('un texto enorme se revisa de un solo recorrido, sin retroceso catastrofico', () => {
    const casos = [
      '1'.repeat(400000),
      '1,'.repeat(300000),
      '$ '.repeat(300000),
      '$' + ' '.repeat(600000),
      '1 '.repeat(300000),
      'a'.repeat(1000000),
      'sensibilidad'.repeat(80000),
      ' sensibilidad'.repeat(60000),
      'sensibilidad' + '*'.repeat(600000),
      '<b>'.repeat(200000)
    ];
    const inicio = Date.now();
    for (const texto of casos) {
      declaracionDeSensibilidad(texto);
      contieneCifrasDeDinero(texto);
      clasificarSensibilidad({ ruta: `${BASE}/Juntas/a.md`, markdown: texto });
    }
    assert.ok(Date.now() - inicio < 15000, 'tardo demasiado');
  });
});

describe('clasificar sensibilidad: lo declarado en el texto', () => {
  const RUTA = `${BASE}/02_Proyecto/ficha.md`;

  it('una ficha con sensibilidad: general valido, fuera de la lista blanca, es general', () => {
    general(`${BASE}/PROYECTO_Portal.md`, con('sensibilidad: general'));
    general(FICHA, con('sensibilidad: General'));
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
      'general # era costos',
      'costos,general',
      'general general',
      'general"',
      '"general',
      'genéral',
      '>',
      '|'
    ]) {
      costos(RUTA, con(`sensibilidad: ${valor}`));
      costos(FICHA, con(`sensibilidad: ${valor}`));
    }
  });

  it('quita comillas en pareja y espacios al leer general', () => {
    for (const valor of ['general', ' general ', '"general"', "'General'"]) {
      general(FICHA, con(`sensibilidad: ${valor}`));
    }
  });
});

describe('declaracion de sensibilidad en el texto crudo', () => {
  const declara = (texto: string) => declaracionDeSensibilidad(texto);

  it('sin la llave no declara nada', () => {
    assert.equal(declara(CUERPO), 'ninguna');
    assert.equal(declara(''), 'ninguna');
    assert.equal(declaracionDeSensibilidad(undefined), 'ninguna');
    assert.equal(declara(con('cliente: Norte')), 'ninguna');
    assert.equal(
      declara(con('titulo: La sensibilidad de los datos es alta')),
      'ninguna'
    );
    assert.equal(declara('hipersensibilidad: alta'), 'ninguna');
  });

  it('una sola llave general en un frontmatter valido se acepta, con cualquier grafia', () => {
    for (const linea of [
      'sensibilidad: general',
      'Sensibilidad: General',
      'SENSIBILIDAD: GENERAL',
      'sensibilidad : general',
      'sensibilidad:\tgeneral',
      'sensibilidad: general   ',
      '"sensibilidad": "general"',
      "'sensibilidad':'general'",
      'sensibilidad:general'
    ]) {
      assert.equal(declara(con(linea)), 'general', linea);
    }
  });

  it('el frontmatter valido admite BOM, CRLF, CR y otras llaves', () => {
    for (const texto of [
      '\uFEFF---\nsensibilidad: general\n---\n# T\n',
      '---\r\nsensibilidad: general\r\n---\r\n# T\r\n',
      '---\rsensibilidad: general\r---\r# T\r',
      '---   \ncliente: Norte\nsensibilidad: general\nproyecto: P\n---   \n# T\n',
      '---\nsensibilidad: general\n---'
    ]) {
      assert.equal(declara(texto), 'general', JSON.stringify(texto));
    }
  });

  it('un general fuera de un frontmatter valido no libera nada', () => {
    for (const [nombre, texto] of [
      ['en el cuerpo', '# T\n\nsensibilidad: general\n'],
      [
        'bloque de codigo',
        '# Plantilla\n\n```yaml\nsensibilidad: general\n```\n'
      ],
      [
        'bloque yaml con delimitadores',
        '```yaml\n---\nsensibilidad: general\n---\n```\n'
      ],
      ['no empieza en el byte 0', '\n---\nsensibilidad: general\n---\n# T\n'],
      ['empieza con espacio', ' ---\nsensibilidad: general\n---\n# T\n'],
      ['dos lineas en blanco antes', '\n\n---\nsensibilidad: general\n---\n'],
      ['cierra con puntos', '---\nsensibilidad: general\n...\n# T\n'],
      ['no cierra', '---\nsensibilidad: general\n# T\n\nTexto.\n'],
      ['despues del cierre', '---\ntitulo: x\n---\nsensibilidad: general\n'],
      ['indentada', '---\nmeta:\n  sensibilidad: general\n---\n# T\n'],
      ['elemento de lista', '---\n- sensibilidad: general\n---\n# T\n'],
      ['con enfasis', '---\n**sensibilidad**: general\n---\n# T\n'],
      [
        'con caracter invisible antes',
        '\u200B---\nsensibilidad: general\n---\n'
      ],
      ['con delimitador raro', '---x\nsensibilidad: general\n---\n']
    ] as const) {
      assert.equal(declara(texto), 'ninguna', nombre);
    }
  });

  it('cualquier linea que parezca sensibilidad: <otro valor> en todo el documento es otra', () => {
    for (const [nombre, texto] of [
      ['en el frontmatter', con('sensibilidad: costos')],
      ['con mayusculas', con('Sensibilidad: COSTOS')],
      ['vacio', con('sensibilidad:')],
      ['lista', con('sensibilidad:\n  - general')],
      ['lista en linea', con('sensibilidad: [general]')],
      ['elemento de lista', con('- sensibilidad: costos')],
      ['mapa en linea', con('{sensibilidad: costos}')],
      ['en una linea con otra llave', con('titulo: x sensibilidad: costos')],
      ['escalar en varias lineas', con('sensibilidad: >\n  general')],
      ['con signo igual', con('sensibilidad = costos')],
      ['comentario', con('# sensibilidad: costos')],
      ['negritas', '# T\n\n**Sensibilidad:** costos\n'],
      [
        'negritas con los dos puntos dentro',
        '# T\n\n**Sensibilidad**: costos\n'
      ],
      ['cita', '# T\n\n> sensibilidad: costos\n'],
      ['bloque de codigo', '# T\n\n```yaml\nsensibilidad: costos\n```\n'],
      ['html', '# T\n\n<b>Sensibilidad</b>: costos\n'],
      ['tabla', '# T\n\n| Sensibilidad: | costos |\n'],
      ['sin frontmatter', 'sensibilidad: costos\n# T\n'],
      ['no empieza en el byte 0', '\n\n---\nsensibilidad: costos\n---\n'],
      ['cierra con puntos', '---\nsensibilidad: costos\n...\n# T\n'],
      ['no cierra', '---\nsensibilidad: costos\n# T\n\nTexto.\n'],
      ['con BOM', '\uFEFF---\nsensibilidad: costos\n---\n'],
      ['solo CR', '---\rsensibilidad: costos\r---\r# T\r'],
      ['CRLF', '---\r\nsensibilidad: costos\r\n---\r\n# T\r\n'],
      ['separador de linea unicode', '# T\u2028sensibilidad: costos\n'],
      ['llave con caracter invisible', con('sensi\u200Bbilidad: costos')],
      ['llave con acento', con('sensibilidád: costos')],
      ['llave con letra cirilica', con('sensibilid\u0430d: costos')],
      [
        'llave de ancho completo',
        con(
          '\uFF53\uFF45\uFF4E\uFF53\uFF49\uFF42\uFF49\uFF4C\uFF49\uFF44\uFF41\uFF44: costos'
        )
      ]
    ] as const) {
      assert.equal(declara(texto), 'otra', nombre);
    }
  });

  it('revisa todo el documento, no solo las primeras lineas', () => {
    const relleno = 'linea\n'.repeat(500);
    assert.equal(
      declara(`# T\n\n${relleno}**Sensibilidad:** costos\n`),
      'otra'
    );
    assert.equal(
      declara(`${con('titulo: x')}${relleno}> sensibilidad: costos\n`),
      'otra'
    );
    assert.equal(
      declara(`${con('sensibilidad: general', relleno)}`),
      'general'
    );
  });

  it('la llave repetida es otra, sin importar cual vaya primero ni donde', () => {
    for (const texto of [
      '---\nsensibilidad: costos\nsensibilidad: general\n---\n',
      '---\nsensibilidad: general\nsensibilidad: costos\n---\n',
      '---\nsensibilidad: general\nSensibilidad: general\n---\n',
      '---\nsensibilidad: general\n---\n\nsensibilidad: general\n',
      '---\nsensibilidad: general\n---\n\n```yaml\nsensibilidad: general\n```\n'
    ]) {
      assert.equal(declara(texto), 'otra', JSON.stringify(texto));
    }
  });

  it('frontmatter valido general mas sensibilidad: costos en el cuerpo, en cualquier forma, gana costos', () => {
    for (const cuerpo of [
      'sensibilidad: costos',
      '**Sensibilidad:** costos',
      '> sensibilidad: costos',
      '```yaml\nsensibilidad: costos\n```',
      '<b>Sensibilidad</b>: costos',
      'Sensibilidad = costos'
    ]) {
      const md = con('sensibilidad: general', `# T\n\n${cuerpo}\n`);
      assert.equal(declara(md), 'otra', cuerpo);
      costos(FICHA, md);
      costos(`${BASE}/Juntas/a.md`, md);
    }
  });

  it('un general que no vale no cambia la clasificacion por si solo', () => {
    // En la lista blanca y sin cifras sigue siendo general por su carpeta.
    general(
      `${BASE}/02_Proyecto/plantilla.md`,
      '# P\n\n```yaml\nsensibilidad: general\n```\n'
    );
    // Fuera de la lista blanca, o con cifras, no lo libera.
    costos(FICHA, '# P\n\n```yaml\nsensibilidad: general\n```\n');
    costos(FICHA, '\n---\nsensibilidad: general\n---\n# P\n');
    costos(
      `${BASE}/02_Proyecto/plantilla.md`,
      '# P\n\n```yaml\nsensibilidad: general\n```\n\nTotal $100.\n'
    );
    costos(
      `${BASE}/PROYECTO_Portal.md`,
      '---\nsensibilidad: general\n...\n# P\n'
    );
  });

  it('**Sensibilidad:** costos despues de la linea 60 fuerza costos', () => {
    const relleno = Array.from({ length: 80 }, (_, i) => `linea ${i}`).join(
      '\n'
    );
    costos(
      `${BASE}/02_Proyecto/alcance.md`,
      `# T\n\n${relleno}\n\n**Sensibilidad:** costos\n`
    );
    costos(
      `${BASE}/Juntas/a.md`,
      con(
        'sensibilidad: general',
        `# T\n\n${relleno}\n\n**Sensibilidad:** costos\n`
      )
    );
  });
});
