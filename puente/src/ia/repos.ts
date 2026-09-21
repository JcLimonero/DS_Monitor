import type {
  ConfiguracionGithub,
  ConfiguracionIa
} from '../config/entorno.js';
import type { RepoCommit, RepoStatus } from '../nucleo/contrato.js';
import { commitsDesde } from '../proveedores/github.js';
import { contextoEmpresas } from '../datos/empresas.js';
import { comoJson, preguntar, texto1 } from './modelo.js';

/**
 * La semana en los repositorios, en tres lineas por proyecto: que se hizo,
 * que hay abierto, en que se atoro. Se genera una vez por semana ISO (o
 * cuando alguien lo pide) con los commits de los ultimos siete dias.
 */
export interface ResumenRepos {
  semana: string;
  desde: string;
  hasta: string;
  proyectos: {
    repo: string;
    commits: number;
    autores: string[];
    lineas: string[];
  }[];
  generadoEn: string;
}

const DIAS = 7;

/** Semana ISO como "2026-W38". */
export function semanaIso(fecha: Date): string {
  const d = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate())
  );
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(
    ((d.getTime() - inicio.getTime()) / 86_400_000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

export async function resumirRepos(
  config: ConfiguracionIa,
  github: ConfiguracionGithub,
  repos: RepoStatus[],
  ahora = new Date()
): Promise<ResumenRepos> {
  const desde = new Date(ahora.getTime() - DIAS * 86_400_000);
  const actividad = await Promise.all(
    repos.map(async (r) => {
      let commits: RepoCommit[] = [];
      try {
        commits = await commitsDesde(github, r.name, desde);
      } catch {
        commits = [];
      }
      return { repo: r, commits };
    })
  );
  const conMovimiento = actividad.filter(
    (a) => a.commits.length > 0 || a.repo.openPullRequests.length > 0
  );
  const proyectosBase = conMovimiento.map((a) => ({
    repo: a.repo.name,
    commits: a.commits.length,
    autores: [
      ...new Set(
        a.commits.map((c) => c.author?.name).filter((x): x is string => !!x)
      )
    ],
    lineas: [] as string[]
  }));
  if (conMovimiento.length === 0) {
    return {
      semana: semanaIso(ahora),
      desde: desde.toISOString(),
      hasta: ahora.toISOString(),
      proyectos: [],
      generadoEn: ahora.toISOString()
    };
  }
  const texto = await preguntar(config, {
    uso: 'repos',
    sistema: `${contextoEmpresas()}\nResumes la semana de trabajo en los repositorios para el equipo. Te doy, por repositorio, los mensajes de commit de los últimos 7 días, los pull requests abiertos y el estado de las revisiones. Responde SOLO JSON: {"proyectos":[{"repo":"...","lineas":["qué se hizo (temas, no lista de commits)","qué quedó abierto o en revisión","qué se atoró o falló, si algo"]}]} con máximo 3 líneas de 120 caracteres por repositorio; omite la tercera si no aplica. Nombra a las personas cuando aporte.`,
    usuario: JSON.stringify(
      conMovimiento.map((a) => ({
        repo: a.repo.name,
        commits: a.commits
          .slice(0, 60)
          .map((c) => `${c.author?.name ?? '?'}: ${c.message ?? ''}`),
        pullRequests: a.repo.openPullRequests.map(
          (p) =>
            `#${p.number} ${p.title} (${p.reviewState}, checks ${p.checkState}${p.draft ? ', borrador' : ''})`
        ),
        revisiones: a.repo.checkState,
        issuesAbiertos: a.repo.openIssues
      }))
    ),
    json: true,
    maxTokens: 2500
  });
  const salida = comoJson<{
    proyectos?: { repo?: string; lineas?: unknown[] }[];
  }>(texto);
  const porRepo = new Map(
    (salida.proyectos ?? []).map((p) => [
      p.repo,
      (Array.isArray(p.lineas) ? p.lineas : [])
        .map(texto1)
        .filter((l): l is string => !!l)
        .slice(0, 3)
    ])
  );
  return {
    semana: semanaIso(ahora),
    desde: desde.toISOString(),
    hasta: ahora.toISOString(),
    proyectos: proyectosBase.map((p) => ({
      ...p,
      lineas: porRepo.get(p.repo) ?? []
    })),
    generadoEn: ahora.toISOString()
  };
}
