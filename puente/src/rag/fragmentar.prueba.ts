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
