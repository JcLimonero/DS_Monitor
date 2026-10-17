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

  it('el frontmatter de proyecto y cliente sigue ganando', () => {
    const doc = deRuta(
      `${PROYECTO_RUTA}/04_Costos/lista.md`,
      `---\nproyecto: Otro\ncliente: Otra Razon\n---\n${FICHA}`
    );
    assert.equal(doc.proyecto, 'Otro');
    assert.equal(doc.cliente, 'Otra Razon');
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
  });

  it('otros archivos fuera de una etapa no llevan proyecto', () => {
    for (const ruta of [
      `${PROYECTO_RUTA}/notas.md`,
      'Empresas/Dealer Solutions/Integraciones/Proveedor/Contacto/Nota.md',
      'Empresas/Dealer Solutions/_Historico/Cliente/Viejo/nota.md'
    ]) {
      assert.equal(deRuta(ruta).proyecto, undefined, ruta);
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

  it('cliente y proyecto siguen con el frontmatter primero, aunque la empresa venga de la ruta', () => {
    const doc = fragmentarMarkdown(conFrente('Dealer Solutions'), {
      driveFileId: 'drive-c',
      ruta: 'Empresas/Itech Dev/TPI/Portal/02_Proyecto/a.md'
    });
    assert.equal(doc.cliente, 'Cliente Frente');
    assert.equal(doc.proyecto, 'Proyecto Frente');
  });
});
