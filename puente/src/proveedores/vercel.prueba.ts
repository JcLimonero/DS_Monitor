import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aDespliegue,
  estadoDespliegue,
  indicadorPlataforma
} from './vercel.js';

describe('traduccion de Vercel', () => {
  it('mapea los estados conocidos', () => {
    assert.equal(estadoDespliegue('READY'), 'listo');
    assert.equal(estadoDespliegue('BUILDING'), 'construyendo');
    assert.equal(estadoDespliegue('QUEUED'), 'en_cola');
    assert.equal(estadoDespliegue('ERROR'), 'error');
    assert.equal(estadoDespliegue('CANCELED'), 'cancelado');
  });

  it('un estado desconocido no pasa por exitoso', () => {
    // Pintar de verde algo que no sabemos que termino es peor que no saberlo.
    assert.equal(estadoDespliegue('ALGO_NUEVO'), 'en_cola');
    assert.equal(estadoDespliegue(undefined), 'en_cola');
  });

  it('mapea el indicador de la pagina de estado', () => {
    assert.equal(indicadorPlataforma('none'), 'operativo');
    assert.equal(indicadorPlataforma('minor'), 'menor');
    assert.equal(indicadorPlataforma('critical'), 'critico');
    assert.equal(indicadorPlataforma('lo que sea'), 'desconocido');
  });

  it('traduce un despliegue completo', () => {
    const despliegue = aDespliegue(
      {
        uid: 'dpl_1',
        name: 'portal-dealer',
        url: 'portal-dealer.vercel.app',
        readyState: 'READY',
        target: 'production',
        created: Date.parse('2026-09-14T10:00:00Z'),
        buildingAt: Date.parse('2026-09-14T10:00:10Z'),
        ready: Date.parse('2026-09-14T10:01:40Z'),
        inspectorUrl: 'https://vercel.com/dealer/portal-dealer/dpl_1',
        creator: { uid: 'u1', username: 'ana', email: 'ana@example.com' },
        meta: {
          githubCommitRef: 'main',
          githubCommitSha: '9f2c1ab3d4e5f6a7b8c9',
          githubCommitMessage: 'Agregar el carrusel'
        }
      },
      'vercel'
    );

    assert.equal(despliegue.state, 'listo');
    assert.equal(despliegue.environment, 'produccion');
    assert.equal(despliegue.url, 'https://portal-dealer.vercel.app');
    assert.equal(despliegue.branch, 'main');
    // El hash se recorta a siete caracteres, como lo muestra la interfaz.
    assert.equal(despliegue.commitSha, '9f2c1ab');
    assert.equal(despliegue.commitMessage, 'Agregar el carrusel');
    assert.equal(despliegue.author?.name, 'ana');
    // La duracion se mide desde que empezo a construir, no desde que se creo.
    assert.equal(despliegue.durationSeconds, 90);
  });

  it('lee los datos de git aunque no vengan de GitHub', () => {
    const despliegue = aDespliegue(
      { uid: 'dpl_2', name: 'sitio', meta: { gitlabCommitRef: 'rediseno' } },
      'vercel'
    );
    assert.equal(despliegue.branch, 'rediseno');
  });

  it('un despliegue sin terminar no reporta duracion', () => {
    const despliegue = aDespliegue(
      {
        uid: 'dpl_3',
        name: 'sitio',
        readyState: 'BUILDING',
        created: Date.now()
      },
      'vercel'
    );
    assert.equal(despliegue.durationSeconds, undefined);
    assert.equal(despliegue.readyAt, undefined);
  });

  it('un despliegue sin vista previa no inventa una URL', () => {
    const despliegue = aDespliegue({ uid: 'dpl_4', name: 'sitio' }, 'vercel');
    assert.equal(despliegue.url, '');
    assert.equal(despliegue.environment, 'vista_previa');
  });
});
