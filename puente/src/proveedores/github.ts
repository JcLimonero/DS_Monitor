import type { ConfiguracionGithub } from '../config/entorno.js';
import type {
  RepoCheckState,
  RepoPullRequest,
  RepoReviewState,
  RepoStatus
} from '../nucleo/contrato.js';
import { conParametros, pedirJson } from '../nucleo/http.js';

/**
 * Estado de los repositorios en GitHub.
 *
 * Por repositorio hace tres consultas:
 *
 *   GET /repos/{owner}/{repo}                      -> rama principal, issues, ultimo push
 *   GET /repos/{owner}/{repo}/commits/{rama}       -> ultimo commit
 *   GET /repos/{owner}/{repo}/commits/{ref}/check-runs -> integracion continua
 *   GET /repos/{owner}/{repo}/pulls?state=open     -> pull requests abiertos
 *
 * Se autentica con `Authorization: Bearer` usando un token con permiso de
 * lectura sobre los repositorios (`repo` en un token clasico, o `contents:read`
 * mas `pull_requests:read` y `checks:read` en uno de grano fino).
 *
 * Los issues abiertos que reporta GitHub en `open_issues_count` incluyen los
 * pull requests, asi que aqui se restan: de otro modo un repositorio con cinco
 * PR y cero issues diria "5 issues abiertos", que es falso.
 */

const BASE = 'https://api.github.com';

interface RepoGithub {
  name?: string;
  full_name?: string;
  html_url?: string;
  private?: boolean;
  default_branch?: string;
  open_issues_count?: number;
  pushed_at?: string;
}

interface CommitGithub {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; email?: string; date?: string };
  };
  author?: { login?: string; id?: number };
}

interface CheckRunsGithub {
  check_runs?: { status?: string; conclusion?: string | null }[];
}

interface PullGithub {
  number?: number;
  title?: string;
  html_url?: string;
  draft?: boolean;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string; id?: number };
  head?: { sha?: string };
}

interface RevisionGithub {
  state?: string;
}

function encabezados(config: ConfiguracionGithub): Record<string, string> {
  return {
    authorization: `Bearer ${config.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28'
  };
}

/**
 * Resume las revisiones de un commit en un solo estado.
 *
 * Un repositorio puede tener varias revisiones sobre el mismo commit. La regla
 * es la que uno usaria a ojo: si alguna fallo, esta en rojo; si alguna sigue
 * corriendo, esta corriendo; si todas pasaron, esta en verde.
 */
export function resumirRevisiones(respuesta: CheckRunsGithub): RepoCheckState {
  const revisiones = respuesta.check_runs ?? [];
  if (revisiones.length === 0) {
    return 'sin_revision';
  }
  if (
    revisiones.some(
      (revision) =>
        revision.conclusion === 'failure' || revision.conclusion === 'timed_out'
    )
  ) {
    return 'fallido';
  }
  if (revisiones.some((revision) => revision.status !== 'completed')) {
    return 'en_curso';
  }
  if (revisiones.some((revision) => revision.conclusion === 'success')) {
    return 'exitoso';
  }
  // Todo completado sin ningun exito ni falla: canceladas o saltadas.
  return 'sin_revision';
}

/** Junta las revisiones de varias personas en un solo estado. */
export function resumirAprobaciones(
  revisiones: RevisionGithub[]
): RepoReviewState {
  if (revisiones.some((revision) => revision.state === 'CHANGES_REQUESTED')) {
    return 'cambios_solicitados';
  }
  if (revisiones.some((revision) => revision.state === 'APPROVED')) {
    return 'aprobado';
  }
  return 'sin_revisar';
}

/**
 * Issues reales, sin contar los pull requests.
 *
 * GitHub mete los PR en `open_issues_count`; restarlos es la unica forma de
 * que el numero signifique lo que dice.
 */
export function issuesReales(
  contadorGithub: number | undefined,
  pullRequests: number
): number {
  return Math.max(0, (contadorGithub ?? 0) - pullRequests);
}

async function estadoDeRepo(
  config: ConfiguracionGithub,
  nombreCompleto: string,
  ahora: Date
): Promise<RepoStatus> {
  const repo = await pedirJson<RepoGithub>(
    'GitHub',
    `${BASE}/repos/${nombreCompleto}`,
    {
      encabezados: encabezados(config)
    }
  );
  const rama = repo.default_branch ?? 'main';

  const [commit, pulls] = await Promise.all([
    pedirJson<CommitGithub>(
      'GitHub',
      `${BASE}/repos/${nombreCompleto}/commits/${rama}`,
      {
        encabezados: encabezados(config)
      }
    ),
    pedirJson<PullGithub[]>(
      'GitHub',
      conParametros(`${BASE}/repos/${nombreCompleto}/pulls`, {
        state: 'open',
        sort: 'created',
        direction: 'asc',
        per_page: String(config.limitePullRequests)
      }),
      { encabezados: encabezados(config) }
    )
  ]);

  const revisiones = await pedirJson<CheckRunsGithub>(
    'GitHub',
    `${BASE}/repos/${nombreCompleto}/commits/${commit.sha ?? rama}/check-runs`,
    { encabezados: encabezados(config) }
  );

  // Las revisiones de cada pull request van en paralelo: en serie, diez PR con
  // dos consultas cada uno tardarian mas que todo lo demas junto.
  const pullRequests = await Promise.all(
    pulls.map(async (pull): Promise<RepoPullRequest> => {
      const [aprobaciones, revisionesPull] = await Promise.all([
        pedirJson<RevisionGithub[]>(
          'GitHub',
          `${BASE}/repos/${nombreCompleto}/pulls/${pull.number}/reviews`,
          { encabezados: encabezados(config) }
        ).catch(() => [] as RevisionGithub[]),
        pull.head?.sha
          ? pedirJson<CheckRunsGithub>(
              'GitHub',
              `${BASE}/repos/${nombreCompleto}/commits/${pull.head.sha}/check-runs`,
              { encabezados: encabezados(config) }
            ).catch(() => ({}) as CheckRunsGithub)
          : Promise.resolve({} as CheckRunsGithub)
      ]);

      return {
        number: pull.number ?? 0,
        title: pull.title ?? 'Sin título',
        url: pull.html_url ?? '',
        author: pull.user?.login
          ? {
              id: String(pull.user.id ?? pull.user.login),
              name: pull.user.login
            }
          : undefined,
        createdAt: pull.created_at ?? ahora.toISOString(),
        updatedAt: pull.updated_at,
        draft: pull.draft ?? false,
        reviewState: resumirAprobaciones(aprobaciones),
        checkState: resumirRevisiones(revisionesPull)
      };
    })
  );

  return {
    id: repo.full_name ?? nombreCompleto,
    name: repo.full_name ?? nombreCompleto,
    url: repo.html_url ?? `https://github.com/${nombreCompleto}`,
    private: repo.private ?? true,
    defaultBranch: rama,
    lastCommit: commit.sha
      ? {
          sha: commit.sha.slice(0, 7),
          message: commit.commit?.message?.split('\n')[0],
          author: commit.commit?.author?.name
            ? {
                id: commit.author?.login ?? commit.commit.author.name,
                name: commit.commit.author.name,
                email: commit.commit.author.email
              }
            : undefined,
          at: commit.commit?.author?.date ?? ahora.toISOString(),
          url: commit.html_url
        }
      : undefined,
    checkState: resumirRevisiones(revisiones),
    openPullRequests: pullRequests,
    openIssues: issuesReales(repo.open_issues_count, pulls.length),
    pushedAt: repo.pushed_at,
    accountId: config.accountId,
    updatedAt: ahora.toISOString()
  };
}

export async function reposGithub(
  config: ConfiguracionGithub,
  ahora = new Date()
): Promise<RepoStatus[]> {
  // Un repositorio que falle no debe tumbar a los demas: se reporta lo que si
  // se pudo leer, que es mas util que una pantalla vacia.
  const resultados = await Promise.allSettled(
    config.repos.map((nombre) => estadoDeRepo(config, nombre, ahora))
  );

  const listos: RepoStatus[] = [];
  for (const [indice, resultado] of resultados.entries()) {
    if (resultado.status === 'fulfilled') {
      listos.push(resultado.value);
    } else {
      console.error(
        `[puente] no se pudo leer ${config.repos[indice]}:`,
        resultado.reason
      );
    }
  }

  if (listos.length === 0 && config.repos.length > 0) {
    // Si fallaron todos, es un problema de credencial o de red, no de un repo.
    throw resultados[0]?.status === 'rejected'
      ? resultados[0].reason
      : new Error('sin datos');
  }

  return listos.sort((a, b) => a.name.localeCompare(b.name));
}
