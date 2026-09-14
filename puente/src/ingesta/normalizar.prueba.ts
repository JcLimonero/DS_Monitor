import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estadoDespliegueEntrante,
  etapaCrm,
  normalizarJuntas,
  normalizarLicencias,
  normalizarPendientes,
  normalizarRepos,
  normalizarRevisiones,
  tipoActividadCrm
} from './normalizar.js';

const ahora = new Date('2026-09-14T12:00:00Z');

describe('normalizar lo recibido', () => {
  it('completa lo que el emisor no manda', () => {
    const [tarea] = normalizarPendientes(
      [{ id: '7', titulo: 'Revisar el corte' }],
      'ops',
      'cuenta-ops',
      ahora
    );
    assert.equal(tarea?.status, 'pendiente');
    assert.equal(tarea?.priority, 'media');
    assert.deepEqual(tarea?.tags, []);
    assert.equal(tarea?.accountId, 'cuenta-ops');
    assert.equal(tarea?.updatedAt, ahora.toISOString());
  });

  it('le pone prefijo de origen al identificador', () => {
    // Sin prefijo, la tarea 1 de Ops y la 1 de otro sistema serian la misma.
    const [tarea] = normalizarPendientes(
      [{ id: '1', titulo: 'x' }],
      'ops',
      'c',
      ahora
    );
    assert.equal(tarea?.id, 'ops-1');
  });

  it('no acepta en silencio un estado que no existe', () => {
    // Corregirlo a "pendiente" dejaria la tarea ahi para siempre sin que nadie
    // se entere de que el emisor esta mandando mal el campo.
    assert.throws(
      () =>
        normalizarPendientes(
          [{ id: '1', titulo: 'x', estado: 'terminado' }],
          'ops',
          'c',
          ahora
        ),
      /estado debe ser uno de/
    );
  });

  it('dice en que renglon esta el problema', () => {
    assert.throws(
      () =>
        normalizarPendientes(
          [{ id: '1', titulo: 'ok' }, { id: '2' }],
          'ops',
          'c',
          ahora
        ),
      /datos\[1\]\.titulo/
    );
  });

  it('una junta sin fin dura una hora', () => {
    const [junta] = normalizarJuntas(
      [{ id: 'j1', titulo: 'Daily', inicio: '2026-09-14T09:00:00Z' }],
      'cal',
      'trabajo'
    );
    assert.equal(junta?.end, '2026-09-14T10:00:00.000Z');
  });

  it('arma la persona con lo que haya', () => {
    const [junta] = normalizarJuntas(
      [
        {
          id: 'j1',
          titulo: 'x',
          inicio: '2026-09-14T09:00:00Z',
          organizador: { nombre: 'Ana', correo: 'ana@example.com' }
        }
      ],
      'cal',
      'trabajo'
    );
    // Sin id explicito se usa el correo, que es estable entre envios.
    assert.equal(junta?.organizer?.id, 'ana@example.com');
    assert.equal(junta?.organizer?.name, 'Ana');
  });

  it('una revision lenta es degradada aunque haya respondido', () => {
    const [entrante] = normalizarRevisiones(
      [
        {
          id: 'api',
          nombre: 'API',
          url: 'https://x',
          ok: true,
          latenciaMs: 1500
        }
      ],
      'plataformas',
      ahora
    );
    assert.equal(entrante?.destino.status, 'degradado');
  });

  it('mantenimiento no se reporta como caido', () => {
    const [entrante] = normalizarRevisiones(
      [
        {
          id: 'api',
          nombre: 'API',
          url: 'https://x',
          ok: false,
          enMantenimiento: true
        }
      ],
      'plataformas',
      ahora
    );
    assert.equal(entrante?.destino.status, 'mantenimiento');
  });

  it('lo que llega por envío se marca como capturado a mano', () => {
    // Salvo que digan lo contrario: casi siempre viene de una hoja o un script
    // propio, no del proveedor, y el portal debe etiquetarlo como tal.
    const [licencia] = normalizarLicencias(
      [{ id: 'l1', producto: 'Alguna', unidad: 'asientos', usado: 3 }],
      'cuenta',
      ahora
    );
    assert.equal(licencia?.manual, true);

    const [viva] = normalizarLicencias(
      [
        {
          id: 'l2',
          producto: 'Otra',
          unidad: 'tokens',
          usado: 10,
          capturadoAMano: false
        }
      ],
      'cuenta',
      ahora
    );
    assert.equal(viva?.manual, false);
  });

  it('acepta el vocabulario de cualquier proveedor de despliegues', () => {
    assert.equal(estadoDespliegueEntrante('READY'), 'listo');
    assert.equal(estadoDespliegueEntrante('success'), 'listo');
    assert.equal(estadoDespliegueEntrante('in_progress'), 'construyendo');
    assert.equal(estadoDespliegueEntrante('failure'), 'error');
    assert.equal(estadoDespliegueEntrante('skipped'), 'cancelado');
  });

  it('un estado de despliegue desconocido nunca pasa por exitoso', () => {
    assert.equal(estadoDespliegueEntrante('algo_nuevo'), 'en_cola');
  });

  it('reconoce las etapas del CRM por palabras', () => {
    assert.equal(etapaCrm('Propuesta enviada'), 'propuesta');
    assert.equal(etapaCrm('Ganada'), 'ganado');
    assert.equal(etapaCrm('Primer contacto'), 'nuevo');
    assert.equal(tipoActividadCrm('Llamada de seguimiento'), 'llamada');
  });

  it('traduce un repositorio con sus pull requests', () => {
    const [repo] = normalizarRepos(
      [
        {
          nombre: 'JcLimonero/VGD_SF_Track',
          url: 'https://github.com/JcLimonero/VGD_SF_Track',
          ramaPrincipal: 'main',
          integracion: 'fallido',
          issuesAbiertos: 4,
          ultimoCommit: {
            sha: '9f2c1ab3d4e5',
            mensaje: 'Levantar el puente',
            fecha: '2026-09-14T10:00:00Z'
          },
          pullRequests: [
            {
              numero: 38,
              titulo: 'Portal de pendientes',
              url: 'https://github.com/x/pull/38',
              creadoEn: '2026-09-10T10:00:00Z',
              revision: 'cambios_solicitados'
            }
          ]
        }
      ],
      'github',
      ahora
    );

    assert.equal(repo?.id, 'JcLimonero/VGD_SF_Track');
    assert.equal(repo?.checkState, 'fallido');
    assert.equal(repo?.lastCommit?.sha, '9f2c1ab');
    assert.equal(repo?.openIssues, 4);
    assert.equal(repo?.openPullRequests[0]?.reviewState, 'cambios_solicitados');
    // Sin dato de integración en el PR, no se asume que pasó.
    assert.equal(repo?.openPullRequests[0]?.checkState, 'sin_revision');
    assert.equal(repo?.openPullRequests[0]?.draft, false);
  });
});
