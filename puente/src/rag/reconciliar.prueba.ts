import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { juntarMarkdown } from './drive-markdown.js';
import { planearReconciliacion } from './reconciliar.js';

describe('reconciliacion con Drive', () => {
  it('baja lo nuevo o editado y borra lo que ya no esta', () => {
    const plan = planearReconciliacion(
      [
        {
          driveFileId: 'a',
          ruta: 'Empresas/Dealer/Norte/02_Proyecto/Juntas/a.md',
          modificadoEn: '2026-10-02T00:00:00.000Z'
        },
        {
          driveFileId: 'b',
          ruta: 'Empresas/Dealer/Norte/Portal/Juntas/b.md',
          modificadoEn: '2026-10-08T00:00:00.000Z'
        },
        {
          driveFileId: 'c',
          ruta: 'Empresas/Itech Dev/TPI/02_Proyecto/Juntas/c.md'
        }
      ],
      [
        {
          driveFileId: 'a',
          ruta: 'Empresas/Dealer/Norte/02_Proyecto/Juntas/a.md',
          modificadoEn: '2026-10-02T00:00:00.000Z'
        },
        {
          driveFileId: 'b',
          ruta: 'Empresas/Dealer/Norte/02_Proyecto/Juntas/b.md',
          modificadoEn: '2026-10-01T00:00:00.000Z'
        },
        {
          driveFileId: 'viejo',
          ruta: 'Empresas/Dealer/x.md',
          modificadoEn: null
        }
      ],
      true
    );
    assert.deepEqual(
      plan.bajar.map((a) => a.driveFileId),
      ['b', 'c']
    );
    assert.deepEqual(plan.borrar, ['viejo']);
  });

  it('un recorrido incompleto no borra', () => {
    const plan = planearReconciliacion(
      [],
      [
        {
          driveFileId: 'viejo',
          ruta: 'a.md',
          modificadoEn: null
        }
      ],
      false
    );
    assert.deepEqual(plan.borrar, []);
  });

  it('junta markdown y se salta el indice', async () => {
    const listar = async (padre: string) => {
      if (padre === 'raiz') {
        return [
          {
            id: 'carp',
            name: 'Itech Dev',
            mimeType: 'application/vnd.google-apps.folder'
          },
          { id: 'ind', name: 'INDICE_RAG.md', mimeType: 'text/markdown' }
        ];
      }
      return [
        {
          id: 'md1',
          name: '2026-10-06_facturacion.md',
          mimeType: 'text/plain',
          modifiedTime: '2026-10-06T00:00:00.000Z',
          webViewLink: 'https://drive.google.com/file/d/md1/view'
        }
      ];
    };
    const { archivos, completo } = await juntarMarkdown(
      [{ id: 'raiz', nombre: 'Empresas' }],
      listar
    );
    assert.equal(completo, true);
    assert.equal(archivos.length, 1);
    assert.equal(
      archivos[0]?.ruta,
      'Empresas/Itech Dev/2026-10-06_facturacion.md'
    );
    assert.equal(archivos[0]?.id, 'md1');
  });
});
