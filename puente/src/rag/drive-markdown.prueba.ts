import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  juntarMarkdown,
  type HijoDrive,
  type MarkdownEnDrive
} from './drive-markdown.js';
import { planearReconciliacion } from './reconciliar.js';

const CARPETA = 'application/vnd.google-apps.folder';

function carpeta(id: string, name: string): HijoDrive {
  return { id, name, mimeType: CARPETA };
}

function archivo(id: string, name: string): HijoDrive {
  return { id, name, mimeType: 'text/markdown' };
}

/**
 * Empresas
 *   Dealer Solutions
 *     Grupo Norte / Taller Norte / Portal
 *       01_Cotizaciones      cot.md, _OBSOLETAS/vieja.md
 *       02_Proyecto          alcance.md
 *     Interno
 *       Arquitectura         diagrama.md
 *       Politicas            politica.md
 *     Proveedor/Interno/Otra/Arquitectura   nota.md
 *   _OBSOLETAS/             restos.md
 *   INDICE_RAG.md
 */
function arbol(): {
  listar: (id: string) => Promise<HijoDrive[]>;
  visitadas: string[];
} {
  const hijos: Record<string, HijoDrive[]> = {
    raiz: [
      carpeta('dealer', 'Dealer Solutions'),
      carpeta('obsoletas-raiz', '_OBSOLETAS'),
      archivo('indice', 'INDICE_RAG.md')
    ],
    dealer: [
      carpeta('grupo', 'Grupo Norte'),
      carpeta('interno', 'Interno'),
      carpeta('proveedor', 'Proveedor')
    ],
    grupo: [carpeta('taller', 'Taller Norte')],
    taller: [carpeta('portal', 'Portal')],
    portal: [carpeta('cot', '01_Cotizaciones'), carpeta('proy', '02_Proyecto')],
    cot: [archivo('cot-1', 'cot.md'), carpeta('obsoletas-cot', '_obsoletas')],
    'obsoletas-cot': [archivo('vieja', 'vieja.md')],
    proy: [archivo('alcance', 'alcance.md')],
    interno: [carpeta('arq', 'Arquitectura'), carpeta('pol', 'Politicas')],
    arq: [archivo('diagrama', 'diagrama.md')],
    pol: [archivo('politica', 'politica.md')],
    proveedor: [carpeta('p-interno', 'Interno')],
    'p-interno': [carpeta('p-otra', 'Otra')],
    'p-otra': [carpeta('p-arq', 'Arquitectura')],
    'p-arq': [archivo('nota', 'nota.md')],
    'obsoletas-raiz': [archivo('restos', 'restos.md')]
  };
  const visitadas: string[] = [];
  return {
    visitadas,
    listar: async (id) => {
      visitadas.push(id);
      return hijos[id] ?? [];
    }
  };
}

function rutas(archivos: MarkdownEnDrive[]): string[] {
  return archivos.map((a) => a.ruta).sort();
}

const RAIZ = [{ id: 'raiz', nombre: 'Empresas' }];

describe('recorrido de Drive', () => {
  it('junta los markdown con su ruta y se salta el indice del RAG', async () => {
    const { listar } = arbol();
    const { archivos, completo } = await juntarMarkdown(RAIZ, listar, {
      excluir: []
    });
    assert.equal(completo, true);
    assert.deepEqual(rutas(archivos), [
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/01_Cotizaciones/_obsoletas/vieja.md',
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/01_Cotizaciones/cot.md',
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/02_Proyecto/alcance.md',
      'Empresas/Dealer Solutions/Interno/Arquitectura/diagrama.md',
      'Empresas/Dealer Solutions/Interno/Politicas/politica.md',
      'Empresas/Dealer Solutions/Proveedor/Interno/Otra/Arquitectura/nota.md',
      'Empresas/_OBSOLETAS/restos.md'
    ]);
  });

  it('por omision no entra a _OBSOLETAS (en cualquier nivel) ni a Interno/Arquitectura', async () => {
    const { listar, visitadas } = arbol();
    const { archivos, completo } = await juntarMarkdown(RAIZ, listar);
    assert.equal(completo, true);
    assert.deepEqual(rutas(archivos), [
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/01_Cotizaciones/cot.md',
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/02_Proyecto/alcance.md',
      'Empresas/Dealer Solutions/Interno/Politicas/politica.md',
      // Interno/Arquitectura solo coincide por sufijo de la ruta de la carpeta:
      // aqui Arquitectura cuelga de Interno/Otra, no de Interno.
      'Empresas/Dealer Solutions/Proveedor/Interno/Otra/Arquitectura/nota.md'
    ]);
    for (const id of ['obsoletas-raiz', 'obsoletas-cot', 'arq']) {
      assert.equal(visitadas.includes(id), false, `no debio listar ${id}`);
    }
  });

  it('compara con la norma del RAG: mayusculas, acentos y guion bajo', async () => {
    const { listar } = arbol();
    const { archivos } = await juntarMarkdown(RAIZ, listar, {
      excluir: ['obsoletas', 'INTERNO / arquitectura', '02 PROYECTO']
    });
    assert.deepEqual(rutas(archivos), [
      'Empresas/Dealer Solutions/Grupo Norte/Taller Norte/Portal/01_Cotizaciones/cot.md',
      'Empresas/Dealer Solutions/Interno/Politicas/politica.md',
      'Empresas/Dealer Solutions/Proveedor/Interno/Otra/Arquitectura/nota.md'
    ]);
  });

  it('un nombre de una sola pieza coincide en cualquier nivel, una ruta no', async () => {
    const { listar } = arbol();
    const porNombre = await juntarMarkdown(RAIZ, listar, {
      excluir: ['Arquitectura']
    });
    assert.equal(
      rutas(porNombre.archivos).some((r) => r.includes('Arquitectura')),
      false
    );
    const porRuta = await juntarMarkdown(RAIZ, listar, {
      excluir: ['Otra/Arquitectura']
    });
    assert.equal(
      rutas(porRuta.archivos).some((r) => r.includes('Otra/Arquitectura')),
      false
    );
    assert.ok(
      rutas(porRuta.archivos).includes(
        'Empresas/Dealer Solutions/Interno/Arquitectura/diagrama.md'
      )
    );
  });

  it('una lista propia reemplaza a la de omision', async () => {
    const { listar } = arbol();
    const { archivos } = await juntarMarkdown(RAIZ, listar, {
      excluir: ['Politicas']
    });
    const todas = rutas(archivos);
    assert.ok(todas.some((r) => r.includes('_OBSOLETAS')));
    assert.ok(todas.some((r) => r.includes('Interno/Arquitectura')));
    assert.equal(
      todas.some((r) => r.includes('Politicas')),
      false
    );
  });

  it('una entrada que no nombra ninguna carpeta no excluye nada', async () => {
    const { listar } = arbol();
    const { archivos } = await juntarMarkdown(RAIZ, listar, {
      excluir: ['-', '', '///']
    });
    assert.equal(archivos.length, 7);
  });

  it('solo excluye carpetas, no archivos con ese nombre', async () => {
    const listar = async (id: string): Promise<HijoDrive[]> =>
      id === 'raiz'
        ? [archivo('a', '_OBSOLETAS.md'), archivo('b', 'b.md')]
        : [];
    const { archivos } = await juntarMarkdown(RAIZ, listar, {
      excluir: ['_OBSOLETAS.md', '_OBSOLETAS']
    });
    assert.equal(archivos.length, 2);
  });

  it('lo excluido no vuelve incompleto el recorrido, pero un fallo de lectura si', async () => {
    const { listar } = arbol();
    const completo = await juntarMarkdown(RAIZ, listar);
    assert.equal(completo.completo, true);
    const conFallo = await juntarMarkdown(RAIZ, async (id) => {
      if (id === 'proy') {
        throw new Error('sin permiso');
      }
      return listar(id);
    });
    assert.equal(conFallo.completo, false);
  });

  it('la reconciliacion borra del indice lo que quedo excluido, si el recorrido es completo', async () => {
    const { listar } = arbol();
    const recorrido = await juntarMarkdown(RAIZ, listar);
    const indexados = ['cot-1', 'diagrama', 'vieja', 'restos'].map(
      (driveFileId) => ({
        driveFileId,
        ruta: null,
        modificadoEn: null
      })
    );
    const plan = planearReconciliacion(
      recorrido.archivos.map((a) => ({
        driveFileId: a.id,
        ruta: a.ruta,
        modificadoEn: a.modifiedTime
      })),
      indexados,
      recorrido.completo
    );
    assert.deepEqual(plan.borrar.sort(), ['diagrama', 'restos', 'vieja']);
    const sinCompletar = planearReconciliacion([], indexados, false);
    assert.deepEqual(sinCompletar.borrar, []);
  });
});
