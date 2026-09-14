import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import {
  PULL_REQUEST_STALE_DAYS,
  REPO_CHECK_LABEL,
  REPO_REVIEW_LABEL,
  RepoCheckState,
  RepoPullRequest,
  RepoReviewState,
  RepoStatus,
  pullRequestAge
} from '../../core/models';
import {
  allPullRequests,
  reposInTrouble,
  stalePullRequests
} from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { RelativePipe } from '../../ui/portal.pipes';

const CLASE_REVISION: Record<RepoCheckState, string> = {
  exitoso:
    'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200',
  fallido: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200',
  en_curso: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200',
  sin_revision: 'bg-surface-muted text-ink-muted'
};

const CLASE_APROBACION: Record<RepoReviewState, string> = {
  aprobado: 'text-ok',
  cambios_solicitados: 'text-danger',
  sin_revisar: 'text-ink-muted'
};

@Component({
  selector: 'pt-repos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyStateComponent,
    IconComponent,
    PageHeaderComponent,
    RelativePipe
  ],
  templateUrl: './repos.component.html'
})
export class ReposComponent {
  private readonly store = inject(PortalStore);

  readonly revisionLabel = REPO_CHECK_LABEL;
  readonly aprobacionLabel = REPO_REVIEW_LABEL;
  readonly diasEstancado = PULL_REQUEST_STALE_DAYS;

  /** Lo roto primero: es lo que hay que atender. */
  readonly repos = computed(() =>
    [...this.store.repos()].sort(
      (a, b) =>
        Number(b.checkState === 'fallido') -
          Number(a.checkState === 'fallido') ||
        b.openPullRequests.length - a.openPullRequests.length ||
        a.name.localeCompare(b.name)
    )
  );

  readonly enRojo = computed(() => reposInTrouble(this.store.repos()));
  readonly pullRequests = computed(() => allPullRequests(this.store.repos()));
  readonly estancados = computed(() => stalePullRequests(this.store.repos()));

  readonly subtitle = computed(() =>
    [
      plural(this.store.repos().length, 'repositorio'),
      `${this.enRojo().length} en rojo`,
      `${this.pullRequests().length} pull requests abiertos`,
      `${plural(this.estancados().length, 'estancado')}`
    ].join(' · ')
  );

  claseRevision(estado: RepoCheckState): string {
    return CLASE_REVISION[estado];
  }

  claseAprobacion(pr: RepoPullRequest): string {
    return CLASE_APROBACION[pr.reviewState];
  }

  edad(pr: RepoPullRequest): number {
    return pullRequestAge(pr);
  }

  estancado(pr: RepoPullRequest): boolean {
    return !pr.draft && this.edad(pr) >= PULL_REQUEST_STALE_DAYS;
  }

  /** Nombre corto del repositorio, sin el propietario. */
  corto(repo: RepoStatus): string {
    return repo.name.split('/').slice(-1)[0] ?? repo.name;
  }
}
