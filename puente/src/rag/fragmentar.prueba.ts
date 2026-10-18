import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fragmentarMarkdown, huellaDocumento } from './fragmentar.js';

const RUTA =
  'Empresas/Itech Dev/TPI Composites/02_Proyecto/Juntas/2026-10-06_facturacion.md';

function markdown(
  transcripcion: string,
  acuerdos = '- Emitir el viernes (Ana)'
): string {
  return `---
id: ff-1
fecha: 2026-10-06
participantes: Ana Solis, Luis Perez
cliente: TPI Composites
proyecto: Facturacion
empresa: Itech Dev
---

# Facturacion octubre

## Resumen

Se reviso el timbrado del mes y quedo el calendario.

## Acuerdos

${acuerdos}

## Transcripción

${transcripcion}
`;
}

describe('fragmentar markdown de junta', () => {
  it('indexa resumen, acuerdos y transcripcion con cabecera', () => {
    const doc = fragmentarMarkdown(
      markdown('**Ana:** Vemos las facturas.\n**Luis:** El timbrado falla.'),
      { driveFileId: 'drive-1', ruta: RUTA }
    );
    assert.equal(doc.empresa, 'itech-dev');
    assert.equal(doc.id, 'ff-1');
    assert.equal(doc.cliente, 'TPI Composites');
    assert.equal(doc.proyecto, 'Facturacion');
    assert.equal(doc.tipo, 'junta');
    assert.deepEqual(doc.participantes, ['Ana Solis', 'Luis Perez']);
    assert.equal(
      doc.huella,
      huellaDocumento(
        markdown(
          '**Ana:** Vemos las facturas.\n**Luis:** El timbrado falla.'
        ).replace(/\r\n/g, '\n')
      )
    );
    assert.equal(doc.huella.length, 64);
    const secciones = doc.fragmentos.map((f) => f.seccion);
    assert.deepEqual(secciones, ['resumen', 'acuerdos', 'transcripcion']);
    assert.match(
      doc.fragmentos[0]?.texto ?? '',
      /\[Itech Dev \/ TPI Composites \/ Facturacion\] Junta 06-oct-2026 — participantes: Ana Solis, Luis Perez/
    );
    assert.match(
      doc.fragmentos[2]?.texto ?? '',
      /\*\*Ana:\*\* Vemos las facturas/
    );
    assert.match(
      doc.fragmentos[2]?.texto ?? '',
      /\*\*Luis:\*\* El timbrado falla/
    );
  });

  it('el resumen y los acuerdos quedan en un solo fragmento aunque sean largos', () => {
    const largo = 'palabra '.repeat(400);
    const doc = fragmentarMarkdown(
      markdown('**Ana:** corto.', `- ${largo}`).replace(
        'Se reviso el timbrado del mes y quedo el calendario.',
        largo
      ),
      {
        driveFileId: 'drive-1',
        ruta: RUTA,
        opciones: { maxTokens: 30, traslape: 5 }
      }
    );
    assert.equal(
      doc.fragmentos.filter((f) => f.seccion === 'resumen').length,
      1
    );
    assert.equal(
      doc.fragmentos.filter((f) => f.seccion === 'acuerdos').length,
      1
    );
  });

  it('agrupa turnos con traslape y parte un turno que no cabe', () => {
    const ana = `**Ana:** ${'a'.repeat(200)}FIN-DE-ANA`;
    const luis = `**Luis:** ${'b'.repeat(200)}`;
    const doc = fragmentarMarkdown(markdown(`${ana}\n${luis}`), {
      driveFileId: 'drive-1',
      ruta: RUTA,
      opciones: { maxTokens: 40, traslape: 8 }
    });
    const trozos = doc.fragmentos.filter((f) => f.seccion === 'transcripcion');
    assert.ok(trozos.length >= 2);
    const segundo = trozos[1]?.texto ?? '';
    assert.match(segundo, /FIN-DE-ANA/);
    const enorme = `**Ana:** ${'z'.repeat(800)}`;
    const partido = fragmentarMarkdown(markdown(enorme), {
      driveFileId: 'drive-1',
      ruta: RUTA,
      opciones: { maxTokens: 40, traslape: 8 }
    });
    const partes = partido.fragmentos.filter(
      (f) => f.seccion === 'transcripcion'
    );
    assert.ok(partes.length >= 2);
    assert.ok(partes.every((p) => p.texto.includes('**Ana:**')));
  });

  it('omite los marcadores vacios y toma la empresa de la ruta', () => {
    const texto = `---
id: ff-2
fecha: 2026-10-07
cliente: Taller Norte
---

# Revision

## Resumen

Quedo el alcance.

## Acuerdos

_Sin acuerdos detectados._

## Transcripción

_Sin conversación transcrita._
`;
    const doc = fragmentarMarkdown(texto, {
      driveFileId: 'drive-2',
      ruta: 'Empresas/Dealer Solutions/Taller Norte/02_Proyecto/Juntas/2026-10-07_revision.md'
    });
    assert.equal(doc.empresa, 'dealer-solutions');
    assert.equal(doc.cliente, 'Taller Norte');
    assert.deepEqual(
      doc.fragmentos.map((f) => f.seccion),
      ['resumen']
    );
  });

  it('rechaza un markdown sin empresa', () => {
    assert.throws(
      () =>
        fragmentarMarkdown('# Hola\n\ntexto', {
          driveFileId: 'x',
          ruta: 'notas/suelto.md'
        }),
      /empresa/
    );
  });
});

const FICHA = `# Ficha

## Resumen

Datos generales.
`;

const PROYECTO_RUTA =
  'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal';

function deRuta(ruta: string, markdown = FICHA) {
  return fragmentarMarkdown(markdown, { driveFileId: 'drive-r', ruta });
}

describe('cliente y proyecto deducidos de la ruta de Drive', () => {
  it('toma el proyecto antes de cualquier carpeta de etapa', () => {
    for (const ruta of [
      `${PROYECTO_RUTA}/02_Proyecto/Juntas/2026-10-06_revision.md`,
      `${PROYECTO_RUTA}/02_Proyecto/alcance.md`,
      `${PROYECTO_RUTA}/01_Cotizaciones/2026-10/COT-1.md`,
      `${PROYECTO_RUTA}/03_Entregables/manual.md`,
      `${PROYECTO_RUTA}/04_Costos/lista.md`,
      `${PROYECTO_RUTA}/Juntas/2026-10-06_revision.md`
    ]) {
      const doc = deRuta(ruta);
      assert.equal(doc.empresa, 'dealer-solutions', ruta);
      assert.equal(doc.proyecto, 'Portal', ruta);
      assert.equal(doc.cliente, 'Grupo Norte', ruta);
    }
  });

  it('la primera carpeta de etapa corta el contexto', () => {
    const doc = deRuta(`${PROYECTO_RUTA}/02_Proyecto/04_Costos/margen.md`);
    assert.equal(doc.proyecto, 'Portal');
    const otra = deRuta(`${PROYECTO_RUTA}/04_Costos/02_Proyecto/margen.md`);
    assert.equal(otra.proyecto, 'Portal');
  });

  it('compara las etapas con la norma del RAG y acepta rutas con barra invertida', () => {
    const doc = deRuta(
      'Empresas\\Dealer Solutions\\Grupo Norte\\Taller Norte\\Portal\\04 costos\\a.md'
    );
    assert.equal(doc.proyecto, 'Portal');
    assert.equal(doc.cliente, 'Grupo Norte');
  });

  it('sin al menos tres segmentos antes de la etapa no hay proyecto', () => {
    const doc = deRuta(
      'Empresas/Itech Dev/TPI Composites/01_Cotizaciones/COT-1.md'
    );
    assert.equal(doc.empresa, 'itech-dev');
    assert.equal(doc.cliente, 'TPI Composites');
    assert.equal(doc.proyecto, undefined);
  });

  it('una ficha PROYECTO_*.md fuera de una etapa toma el proyecto de su carpeta', () => {
    const doc = deRuta(`${PROYECTO_RUTA}/PROYECTO_Portal.md`);
    assert.equal(doc.proyecto, 'Portal');
    assert.equal(doc.cliente, 'Grupo Norte');
    const minusculas = deRuta(`${PROYECTO_RUTA}/proyecto_portal.MD`);
    assert.equal(minusculas.proyecto, 'Portal');
  });

  it('una ficha PROYECTO_*.md poco profunda no inventa proyecto', () => {
    const doc = deRuta('Empresas/Dealer Solutions/Grupo Norte/PROYECTO_X.md');
    assert.equal(doc.proyecto, undefined);
  });

  it('CLIENTE.md no lleva proyecto', () => {
    const doc = deRuta(
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/CLIENTE.md'
    );
    assert.equal(doc.proyecto, undefined);
    assert.equal(doc.cliente, 'Grupo Norte');
  });

  it('otros archivos fuera de una etapa no llevan proyecto ni cliente', () => {
    for (const ruta of [
      `${PROYECTO_RUTA}/notas.md`,
      'Empresas/Dealer Solutions/Integraciones/Proveedor/Contacto/Nota.md',
      'Empresas/Dealer Solutions/_Historico/Cliente/Viejo/nota.md'
    ]) {
      assert.equal(deRuta(ruta).proyecto, undefined, ruta);
      assert.equal(deRuta(ruta).cliente, undefined, ruta);
    }
  });

  it('sin ruta no hay proyecto ni cliente', () => {
    const doc = fragmentarMarkdown(`---\nempresa: Itech Dev\n---\n${FICHA}`, {
      driveFileId: 'drive-r'
    });
    assert.equal(doc.proyecto, undefined);
    assert.equal(doc.cliente, undefined);
  });
});

describe('la empresa la manda la ruta de Drive', () => {
  const conFrente = (empresa: string) =>
    `---\nempresa: ${empresa}\ncliente: Cliente Frente\nproyecto: Proyecto Frente\n---\n${FICHA}`;

  it('con ruta que resuelve a una empresa, el empresa: del frontmatter se ignora', () => {
    const doc = fragmentarMarkdown(conFrente('Dealer Solutions'), {
      driveFileId: 'drive-c',
      ruta: 'Empresas/Itech Dev/TPI/Portal/02_Proyecto/a.md'
    });
    assert.equal(doc.empresa, 'itech-dev');
    assert.equal(doc.empresaDelFrontmatterIgnorada, true);
    // La cabecera no lleva el nombre de la empresa que se ignoro.
    assert.ok(doc.fragmentos.length > 0);
    assert.doesNotMatch(
      doc.fragmentos.map((f) => f.texto).join('\n'),
      /Dealer Solutions/
    );
    assert.match(doc.fragmentos[0]?.texto ?? '', /^\[itech-dev \//);
  });

  it('un empresa: que no se reconoce tambien se ignora cuando la ruta resuelve', () => {
    const doc = fragmentarMarkdown(conFrente('Empresa Inventada'), {
      driveFileId: 'drive-c',
      ruta: 'Empresas/Dealer Solutions/TPI/Portal/02_Proyecto/a.md'
    });
    assert.equal(doc.empresa, 'dealer-solutions');
    assert.equal(doc.empresaDelFrontmatterIgnorada, true);
  });

  it('si el frontmatter coincide con la ruta no hay conflicto y conserva su nombre', () => {
    const doc = fragmentarMarkdown(conFrente('Itech Dev'), {
      driveFileId: 'drive-c',
      ruta: 'Empresas/Itech Dev/TPI/Portal/02_Proyecto/a.md'
    });
    assert.equal(doc.empresa, 'itech-dev');
    assert.equal(doc.empresaDelFrontmatterIgnorada, false);
    assert.equal(doc.empresaNombre, 'Itech Dev');
  });

  it('sin empresa en el frontmatter manda la ruta y no hay conflicto', () => {
    const doc = deRuta('Empresas/Itech Dev/TPI/Portal/02_Proyecto/a.md');
    assert.equal(doc.empresa, 'itech-dev');
    assert.equal(doc.empresaDelFrontmatterIgnorada, false);
  });

  it('una carpeta de cliente con nombre de empresa no le gana al frontmatter', () => {
    for (const [ruta, esperada] of [
      ['Empresas/_POR_CLASIFICAR/Operativ/nota.md', 'itech-dev'],
      ['Empresas/_Historico/Cliente X/Nexus/a.md', 'itech-dev'],
      ['Empresas/Grupo Nuevo/Dealer/02_Proyecto/a.md', 'itech-dev']
    ] as const) {
      const doc = fragmentarMarkdown(conFrente('Itech Dev'), {
        driveFileId: 'drive-c',
        ruta
      });
      assert.equal(doc.empresa, esperada, ruta);
      assert.equal(doc.empresaDelFrontmatterIgnorada, false, ruta);
      // Sin empresa en la primera carpeta, la ruta no da cliente ni proyecto:
      // valen los del frontmatter y no hay conflicto que avisar.
      assert.equal(doc.cliente, 'Cliente Frente', ruta);
      assert.equal(doc.proyecto, 'Proyecto Frente', ruta);
      assert.equal(doc.clienteDelFrontmatterIgnorado, false, ruta);
      assert.equal(doc.proyectoDelFrontmatterIgnorado, false, ruta);
    }
  });

  it('sin ruta vale el frontmatter', () => {
    const doc = fragmentarMarkdown(conFrente('Operativ AI'), {
      driveFileId: 'drive-c'
    });
    assert.equal(doc.empresa, 'operativai');
    assert.equal(doc.empresaDelFrontmatterIgnorada, false);
    assert.equal(doc.empresaNombre, 'Operativ AI');
  });

  it('con una ruta que no resuelve a ninguna empresa vale el frontmatter', () => {
    const doc = fragmentarMarkdown(conFrente('Operativ AI'), {
      driveFileId: 'drive-c',
      ruta: 'Otros/Cliente Suelto/02_Proyecto/a.md'
    });
    assert.equal(doc.empresa, 'operativai');
    assert.equal(doc.empresaDelFrontmatterIgnorada, false);
  });

  it('cliente y proyecto tambien salen de la ruta cuando la empresa viene de ella', () => {
    const doc = fragmentarMarkdown(conFrente('Dealer Solutions'), {
      driveFileId: 'drive-c',
      ruta: 'Empresas/Itech Dev/TPI/Portal/02_Proyecto/a.md'
    });
    assert.equal(doc.cliente, 'TPI');
    assert.equal(doc.proyecto, 'Portal');
  });
});

describe('cliente de las fichas CLIENTE.md y PROYECTO_*.md en la carpeta del cliente', () => {
  const clienteDe = (ruta: string) => deRuta(ruta).cliente;

  it('CLIENTE.md toma el cliente de facturacion: el segundo segmento tras la empresa', () => {
    for (const [ruta, cliente] of [
      ['Empresas/Nexus Q Tech/Total Dealer/CLIENTE.md', 'Total Dealer'],
      [
        'Empresas/Dealer Solutions/Grupo Vanguardia/CLIENTE.md',
        'Grupo Vanguardia'
      ],
      ['Empresas/Operativ AI/Grupo Troy/CLIENTE.md', 'Grupo Troy'],
      // La ficha de un cliente final queda con el cliente de facturacion.
      ['Empresas/Nexus Q Tech/Total Dealer/Huesca/CLIENTE.md', 'Total Dealer'],
      [
        'Empresas/Dealer Solutions/Grupo Vanguardia/Motonova/CLIENTE.md',
        'Grupo Vanguardia'
      ],
      // Se conserva el nombre de la carpeta, con sus acentos y mayusculas.
      [
        'Empresas/Dealer Solutions/Cooperación Ñandú S.A./CLIENTE.md',
        'Cooperación Ñandú S.A.'
      ]
    ] as const) {
      const doc = deRuta(ruta);
      assert.equal(doc.cliente, cliente, ruta);
      assert.equal(doc.proyecto, undefined, ruta);
    }
  });

  it('reconoce el nombre del archivo sin importar mayusculas ni el separador de la ruta', () => {
    for (const ruta of [
      'Empresas/Nexus Q Tech/Total Dealer/cliente.md',
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE.MD',
      'Empresas\\Nexus Q Tech\\Total Dealer\\CLIENTE.md',
      'Empresas//Nexus Q Tech//Total Dealer//CLIENTE.md',
      'empresas/nexus q tech/Total Dealer/CLIENTE.md',
      'Nexus Q Tech/Total Dealer/CLIENTE.md'
    ]) {
      assert.equal(clienteDe(ruta), 'Total Dealer', ruta);
    }
  });

  it('PROYECTO_*.md en la raiz del cliente lleva el cliente y no inventa proyecto', () => {
    const doc = deRuta('Empresas/Nexus Q Tech/Total Dealer/PROYECTO_Infra.md');
    assert.equal(doc.cliente, 'Total Dealer');
    assert.equal(doc.proyecto, undefined);
  });

  it('PROYECTO_*.md dentro de la carpeta de un proyecto lleva cliente y proyecto', () => {
    // Una carpeta de proyecto llamada como una reservada solo cuenta en el
    // segundo segmento: aqui es el tercero.
    for (const [ruta, proyecto] of [
      [
        'Empresas/Nexus Q Tech/Total Dealer/Integraciones/PROYECTO_TD.md',
        'Integraciones'
      ],
      [
        'Empresas/Nexus Q Tech/Total Dealer/Huesca/Portal/PROYECTO_Portal.md',
        'Portal'
      ]
    ] as const) {
      const doc = deRuta(ruta);
      assert.equal(doc.cliente, 'Total Dealer', ruta);
      assert.equal(doc.proyecto, proyecto, ruta);
    }
  });

  it('no da cliente a un archivo que no es la ficha', () => {
    for (const ruta of [
      'Empresas/Nexus Q Tech/Total Dealer/notas.md',
      'Empresas/Nexus Q Tech/Total Dealer/README.md',
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE_backup_2026-10-14.md',
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTES.md',
      'Empresas/Nexus Q Tech/Total Dealer/MI_CLIENTE.md',
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE.md.bak',
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE.mdx',
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE .md',
      'Empresas/Nexus Q Tech/Total Dealer/PROYECTO.md',
      'Empresas/Nexus Q Tech/Total Dealer/PROYECTO-Infra.md',
      'Empresas/Nexus Q Tech/Total Dealer/EMPRESA.md',
      // La C es cirilica.
      'Empresas/Nexus Q Tech/Total Dealer/\u0421LIENTE.md',
      // CLIENTE.md es el archivo, no una carpeta.
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE.md/nota.md'
    ]) {
      assert.equal(clienteDe(ruta), undefined, ruta);
    }
  });

  it('no da cliente si el segundo segmento no es un cliente', () => {
    for (const ruta of [
      // Directamente bajo la carpeta de la empresa.
      'Empresas/Nexus Q Tech/CLIENTE.md',
      'Empresas/Nexus Q Tech/PROYECTO_Interno.md',
      // Brand kits, de la empresa y de clientes.
      'Empresas/Nexus Q Tech/00_Brand_Kit/CLIENTE.md',
      'Empresas/Nexus Q Tech/00_Brand_Kits_Clientes/Total Dealer/CLIENTE.md',
      'Empresas/Nexus Q Tech/00_Brand_Kits_Clientes/Total Dealer/00_Brand_Kit/PROYECTO_X.md',
      'Empresas/Dealer Solutions/Brand Kit/CLIENTE.md',
      'Empresas/Itech Dev/00_Marca/CLIENTE.md',
      // Integraciones (proveedores), interno y facturacion.
      'Empresas/Dealer Solutions/Integraciones/Proveedor/CLIENTE.md',
      'Empresas/Dealer Solutions/Integraciones/Proveedor/Contacto/PROYECTO_X.md',
      'Empresas/Dealer Solutions/integraciones/Proveedor/CLIENTE.md',
      'Empresas/Itech Dev/Interno/CLIENTE.md',
      'Empresas/Itech Dev/Interno/Capacitacion/PROYECTO_Curso.md',
      'Empresas/Itech Dev/_Interno_LimonLabs/CLIENTE.md',
      'Empresas/Nexus Q Tech/Facturación/Nexus/CLIENTE.md',
      'Empresas/Nexus Q Tech/Facturacion/CLIENTE.md',
      'Empresas/Nexus Q Tech/Empresas/CLIENTE.md',
      // Carpetas del sistema: con guion bajo o punto al inicio, o numeradas.
      'Empresas/Nexus Q Tech/_OBSOLETAS/CLIENTE.md',
      'Empresas/Nexus Q Tech/_POR_CLASIFICAR/Total Dealer/CLIENTE.md',
      'Empresas/Nexus Q Tech/.oculta/CLIENTE.md',
      'Empresas/Nexus Q Tech/00_Algo/CLIENTE.md',
      'Empresas/Nexus Q Tech/99_Archivo/Total Dealer/CLIENTE.md',
      // Un segmento vacio o de solo espacios.
      'Empresas/Nexus Q Tech/ /CLIENTE.md'
    ]) {
      assert.equal(clienteDe(ruta), undefined, ruta);
    }
  });

  it('no da cliente a carpetas del sistema aunque no lleven guion bajo ni numero', () => {
    for (const ruta of [
      'Empresas/Nexus Q Tech/Historico/CLIENTE.md',
      'Empresas/Nexus Q Tech/Por Clasificar/Total Dealer/CLIENTE.md',
      'Empresas/Nexus Q Tech/Prospectos/CLIENTE.md',
      'Empresas/Nexus Q Tech/_OBSOLETAS/CLIENTE.md',
      'Empresas/Nexus Q Tech/DUPLICADOS/CLIENTE.md',
      // Un caracter invisible o de ancho completo no disfraza una carpeta del sistema.
      'Empresas/Nexus Q Tech/\u200B_Historico/CLIENTE.md',
      'Empresas/Nexus Q Tech/\uFF3FHistorico/CLIENTE.md',
      'Empresas/Nexus Q Tech/00\u200B_Brand_Kit/CLIENTE.md',
      'Empresas/Nexus Q Tech/00\uFF3FBrand_Kit/CLIENTE.md',
      'Empresas/Nexus Q Tech/\uFEFF.oculta/CLIENTE.md'
    ]) {
      assert.equal(clienteDe(ruta), undefined, ruta);
    }
    // Un cliente con digitos o simbolos en el nombre, pero que empieza con letra o digito, si cuenta.
    for (const [ruta, cliente] of [
      ['Empresas/Nexus Q Tech/3M Mexico/CLIENTE.md', '3M Mexico'],
      ['Empresas/Nexus Q Tech/24 Horas/CLIENTE.md', '24 Horas'],
      ['Empresas/Nexus Q Tech/Grupo AS (Naosa)/CLIENTE.md', 'Grupo AS (Naosa)']
    ] as const) {
      assert.equal(clienteDe(ruta), cliente, ruta);
    }
  });

  it('una carpeta interna Empresas no saca la ficha de su empresa ni le cambia el cliente', () => {
    const frente = `---\nempresa: Itech Dev\n---\n${FICHA}`;
    const doc = deRuta(
      'Itech Dev/Cliente I/EMPRESAS/Operativ AI/Cliente C/CLIENTE.md',
      frente
    );
    assert.equal(doc.empresa, 'itech-dev');
    assert.equal(doc.cliente, 'Cliente I');
    const conEtapa = deRuta(
      'itech-dev/Cliente I/Proyecto I/EMPRESAS/Operativ AI/Cliente C/02_Proyecto/a.md',
      frente
    );
    assert.equal(conEtapa.empresa, 'itech-dev');
    assert.equal(conEtapa.cliente, 'Cliente I');
  });

  it('no da cliente si la primera carpeta no es una empresa conocida', () => {
    const frente = `---\nempresa: Dealer Solutions\n---\n${FICHA}`;
    for (const ruta of [
      'Empresas/_Historico/Costumer Solutions/Saverglass/CLIENTE.md',
      'Empresas/_POR_CLASIFICAR/Total Dealer/CLIENTE.md',
      'Empresas/Facturacion/Nexus/CLIENTE.md',
      'Empresas/Grupo Nuevo/Total Dealer/CLIENTE.md',
      'Otros/Total Dealer/CLIENTE.md',
      // Una carpeta de cliente con nombre de empresa no hace de empresa.
      'Empresas/_Historico/Dealer Solutions/Total Dealer/CLIENTE.md'
    ]) {
      const doc = deRuta(ruta, frente);
      assert.equal(doc.empresa, 'dealer-solutions', ruta);
      assert.equal(doc.cliente, undefined, ruta);
      assert.equal(doc.proyecto, undefined, ruta);
    }
  });

  it('una empresa del catalogo (no solo los alias) tambien da cliente', () => {
    const doc = fragmentarMarkdown(FICHA, {
      driveFileId: 'drive-r',
      ruta: 'Empresas/Grupo Nuevo/Total Dealer/CLIENTE.md',
      catalogo: [{ id: 'grupo-nuevo', nombre: 'Grupo Nuevo' }]
    });
    assert.equal(doc.empresa, 'grupo-nuevo');
    assert.equal(doc.cliente, 'Total Dealer');
  });

  it('sin ruta no hay cliente', () => {
    const doc = fragmentarMarkdown(`---\nempresa: Itech Dev\n---\n${FICHA}`, {
      driveFileId: 'drive-r'
    });
    assert.equal(doc.cliente, undefined);
  });

  it('la cabecera del texto lleva el cliente de la ficha', () => {
    const doc = deRuta('Empresas/Nexus Q Tech/Total Dealer/Huesca/CLIENTE.md');
    assert.match(
      doc.fragmentos[0]?.texto ?? '',
      /^\[nexusqtech \/ Total Dealer\] /
    );
  });
});

describe('cliente y proyecto: la ruta manda sobre el frontmatter', () => {
  const frente = (cliente?: string, proyecto?: string) =>
    `---\n${cliente ? `cliente: ${cliente}\n` : ''}${proyecto ? `proyecto: ${proyecto}\n` : ''}---\n${FICHA}`;

  it('si la ruta da cliente y proyecto, el frontmatter distinto se ignora y se avisa', () => {
    const doc = deRuta(
      `${PROYECTO_RUTA}/04_Costos/lista.md`,
      frente('Otra Razon', 'Otro')
    );
    assert.equal(doc.cliente, 'Grupo Norte');
    assert.equal(doc.proyecto, 'Portal');
    assert.equal(doc.clienteDelFrontmatterIgnorado, true);
    assert.equal(doc.proyectoDelFrontmatterIgnorado, true);
    // La cabecera del texto no lleva lo que se ignoro.
    assert.ok(doc.fragmentos.length > 0);
    assert.doesNotMatch(
      doc.fragmentos.map((f) => f.texto).join('\n'),
      /Otra Razon|Otro/
    );
    assert.match(
      doc.fragmentos[0]?.texto ?? '',
      /\[dealer-solutions \/ Grupo Norte \/ Portal\]/
    );
  });

  it('se avisa campo por campo', () => {
    const soloCliente = deRuta(
      `${PROYECTO_RUTA}/02_Proyecto/a.md`,
      frente('Otra Razon', 'Portal')
    );
    assert.equal(soloCliente.clienteDelFrontmatterIgnorado, true);
    assert.equal(soloCliente.proyectoDelFrontmatterIgnorado, false);
    const soloProyecto = deRuta(
      `${PROYECTO_RUTA}/02_Proyecto/a.md`,
      frente('Grupo Norte', 'Otro')
    );
    assert.equal(soloProyecto.clienteDelFrontmatterIgnorado, false);
    assert.equal(soloProyecto.proyectoDelFrontmatterIgnorado, true);
  });

  it('un frontmatter que coincide con la ruta (sin mayusculas ni acentos) no es conflicto y queda el nombre de la carpeta', () => {
    const doc = deRuta(
      'Empresas/Dealer Solutions/Cooperación Ñandú/Taller/02_Proyecto/a.md',
      frente('cooperacion nandu', 'TALLER')
    );
    assert.equal(doc.cliente, 'Cooperación Ñandú');
    assert.equal(doc.proyecto, 'Taller');
    assert.equal(doc.clienteDelFrontmatterIgnorado, false);
    assert.equal(doc.proyectoDelFrontmatterIgnorado, false);
  });

  it('el frontmatter solo llena lo que la ruta no da', () => {
    // Con dos segmentos antes de la etapa la ruta da cliente pero no proyecto.
    const sinProyecto = deRuta(
      'Empresas/Itech Dev/TPI Composites/02_Proyecto/a.md',
      frente('Otra Razon', 'Facturacion')
    );
    assert.equal(sinProyecto.cliente, 'TPI Composites');
    assert.equal(sinProyecto.proyecto, 'Facturacion');
    assert.equal(sinProyecto.clienteDelFrontmatterIgnorado, true);
    assert.equal(sinProyecto.proyectoDelFrontmatterIgnorado, false);
    // Una ruta sin etapa ni ficha no da nada: valen el cliente y el proyecto del frontmatter.
    const sinEtapa = deRuta(
      'Empresas/Itech Dev/TPI Composites/notas.md',
      frente('Cliente Frente', 'Proyecto Frente')
    );
    assert.equal(sinEtapa.cliente, 'Cliente Frente');
    assert.equal(sinEtapa.proyecto, 'Proyecto Frente');
    assert.equal(sinEtapa.clienteDelFrontmatterIgnorado, false);
    assert.equal(sinEtapa.proyectoDelFrontmatterIgnorado, false);
    // Sin ruta, tambien.
    const sinRuta = fragmentarMarkdown(
      `---\nempresa: Itech Dev\ncliente: Cliente Frente\nproyecto: Proyecto Frente\n---\n${FICHA}`,
      { driveFileId: 'drive-r' }
    );
    assert.equal(sinRuta.cliente, 'Cliente Frente');
    assert.equal(sinRuta.proyecto, 'Proyecto Frente');
  });

  it('una ficha CLIENTE.md no toma el cliente del frontmatter si la ruta lo da', () => {
    const doc = deRuta(
      'Empresas/Nexus Q Tech/Total Dealer/CLIENTE.md',
      frente('Huesca')
    );
    assert.equal(doc.cliente, 'Total Dealer');
    assert.equal(doc.clienteDelFrontmatterIgnorado, true);
  });

  it('en una carpeta que no es de cliente el frontmatter llena el cliente (la ruta no lo da)', () => {
    const doc = deRuta(
      'Empresas/Dealer Solutions/Integraciones/Proveedor/CLIENTE.md',
      frente('Cliente Frente')
    );
    assert.equal(doc.cliente, 'Cliente Frente');
    assert.equal(doc.clienteDelFrontmatterIgnorado, false);
  });
});
