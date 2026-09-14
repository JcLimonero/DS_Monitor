import { RepoStatus } from '../../models';
import { DEMO_PEOPLE } from './demo-people';

/**
 * Repositorios de demostración.
 *
 * Los nombres son inventados menos el del propio proyecto, que ya es público.
 */
export function demoRepos(accountId: string, now = new Date()): RepoStatus[] {
  const hace = (minutos: number) =>
    new Date(now.getTime() - minutos * 60_000).toISOString();

  return [
    {
      id: 'dealer/portal-dealer',
      name: 'dealer/portal-dealer',
      url: 'https://github.com/dealer/portal-dealer',
      private: true,
      defaultBranch: 'main',
      lastCommit: {
        sha: '9f2c1ab',
        message: 'Levantar el puente con seis conexiones',
        author: DEMO_PEOPLE.ana,
        at: hace(12),
        url: 'https://github.com/dealer/portal-dealer/commit/9f2c1ab'
      },
      checkState: 'en_curso',
      openPullRequests: [
        {
          number: 38,
          title: 'Recibir datos por API en lugar de ir por ellos',
          url: 'https://github.com/dealer/portal-dealer/pull/38',
          author: DEMO_PEOPLE.yo,
          createdAt: hace(90),
          updatedAt: hace(12),
          draft: false,
          reviewState: 'sin_revisar',
          checkState: 'en_curso'
        }
      ],
      openIssues: 3,
      pushedAt: hace(12),
      accountId,
      updatedAt: now.toISOString()
    },
    {
      id: 'dealer/sitio-itech',
      name: 'dealer/sitio-itech',
      url: 'https://github.com/dealer/sitio-itech',
      private: false,
      defaultBranch: 'main',
      lastCommit: {
        sha: '2ad4f18',
        message: 'Actualizar los datos de contacto del pie',
        author: DEMO_PEOPLE.carla,
        at: hace(1_340)
      },
      checkState: 'fallido',
      openPullRequests: [
        {
          number: 12,
          title: 'Rehacer el hero con el nuevo logo',
          url: 'https://github.com/dealer/sitio-itech/pull/12',
          author: DEMO_PEOPLE.carla,
          createdAt: hace(11_500),
          updatedAt: hace(46),
          draft: false,
          reviewState: 'cambios_solicitados',
          checkState: 'fallido'
        },
        {
          number: 11,
          title: 'Subir las imágenes a WebP',
          url: 'https://github.com/dealer/sitio-itech/pull/11',
          author: DEMO_PEOPLE.ana,
          createdAt: hace(20_000),
          updatedAt: hace(4_000),
          draft: true,
          reviewState: 'sin_revisar',
          checkState: 'exitoso'
        }
      ],
      openIssues: 7,
      pushedAt: hace(46),
      accountId,
      updatedAt: now.toISOString()
    },
    {
      id: 'dealer/api-vanguardia',
      name: 'dealer/api-vanguardia',
      url: 'https://github.com/dealer/api-vanguardia',
      private: true,
      defaultBranch: 'main',
      lastCommit: {
        sha: 'b31f7c5',
        message: 'Separar el timbrado del guardado de la factura',
        author: DEMO_PEOPLE.bruno,
        at: hace(310)
      },
      checkState: 'exitoso',
      openPullRequests: [],
      openIssues: 1,
      pushedAt: hace(310),
      accountId,
      updatedAt: now.toISOString()
    },
    {
      id: 'dealer/tablero-leads',
      name: 'dealer/tablero-leads',
      url: 'https://github.com/dealer/tablero-leads',
      private: true,
      defaultBranch: 'main',
      lastCommit: {
        sha: 'e05a9d2',
        message: 'Mover el corte diario a la madrugada',
        author: DEMO_PEOPLE.elena,
        at: hace(420)
      },
      checkState: 'exitoso',
      openPullRequests: [],
      openIssues: 0,
      pushedAt: hace(420),
      accountId,
      updatedAt: now.toISOString()
    }
  ];
}
