import { Person } from './common.model';

/** Resultado de la integración continua de una rama. */
export type RepoCheckState =
  'exitoso' | 'fallido' | 'en_curso' | 'sin_revision';

export const REPO_CHECK_LABEL: Record<RepoCheckState, string> = {
  exitoso: 'En verde',
  fallido: 'En rojo',
  en_curso: 'Corriendo',
  sin_revision: 'Sin revisión'
};

export type RepoReviewState =
  'aprobado' | 'cambios_solicitados' | 'sin_revisar';

export const REPO_REVIEW_LABEL: Record<RepoReviewState, string> = {
  aprobado: 'Aprobado',
  cambios_solicitados: 'Cambios solicitados',
  sin_revisar: 'Sin revisar'
};

export interface RepoCommit {
  sha: string;
  message?: string;
  author?: Person;
  at: string;
  url?: string;
}

export interface RepoPullRequest {
  number: number;
  title: string;
  url: string;
  author?: Person;
  createdAt: string;
  updatedAt?: string;
  draft: boolean;
  reviewState: RepoReviewState;
  checkState: RepoCheckState;
}

export interface RepoStatus {
  /** "propietario/repositorio", que es además el identificador. */
  id: string;
  name: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  lastCommit?: RepoCommit;
  /** Integración continua de la rama principal. */
  checkState: RepoCheckState;
  openPullRequests: RepoPullRequest[];
  openIssues: number;
  pushedAt?: string;
  accountId: string;
  updatedAt: string;
}

/** Un repositorio pide atención si su rama principal está en rojo. */
export function repoNeedsAttention(repo: RepoStatus): boolean {
  return repo.checkState === 'fallido';
}

/** Días que lleva abierto un pull request. */
export function pullRequestAge(pr: RepoPullRequest, now = new Date()): number {
  return Math.floor(
    (now.getTime() - new Date(pr.createdAt).getTime()) / 86_400_000
  );
}

/** A partir de aquí un pull request lleva demasiado tiempo abierto. */
export const PULL_REQUEST_STALE_DAYS = 7;
