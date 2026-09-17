import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { ResumenRepos } from '../../core/ia/ia.models';
import { IaService, describirError } from '../../core/ia/ia.service';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe } from '../../ui/portal.pipes';

/** La semana en los repositorios, tres líneas por proyecto. */
@Component({
  selector: 'pt-ia-repos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, DayPipe],
  template: `
    @if (resumen(); as r) {
      <section class="card card-pad">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold text-ink">
              La semana en los repos
            </h2>
            <p class="text-xs text-ink-muted">
              {{ r.desde | dia }} – {{ r.hasta | dia }} · semana {{ r.semana }}
            </p>
          </div>
          <button
            type="button"
            class="btn"
            [disabled]="cargando()"
            (click)="regenerar()"
            aria-label="Volver a generar">
            <pt-icon name="refrescar" class="h-4 w-4" />
          </button>
        </div>
        @if (r.proyectos.length === 0) {
          <p class="mt-3 text-sm text-ink-muted">
            Sin movimiento en los últimos siete días.
          </p>
        }
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          @for (p of r.proyectos; track p.repo) {
            <article class="rounded-lg border border-line p-3 text-sm">
              <p class="font-medium text-ink">{{ p.repo }}</p>
              <p class="text-xs text-ink-subtle">
                {{ p.commits }} commits
                @if (p.autores.length) {
                  · {{ p.autores.join(', ') }}
                }
              </p>
              <ul class="mt-2 space-y-1 text-ink-muted">
                @for (l of p.lineas; track $index) {
                  <li class="flex items-start gap-2">
                    <span
                      class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"></span>
                    <span>{{ l }}</span>
                  </li>
                }
              </ul>
            </article>
          }
        </div>
        @if (error(); as e) {
          <p class="mt-2 text-xs text-danger">{{ e }}</p>
        }
      </section>
    }
  `
})
export class IaReposComponent {
  private readonly ia = inject(IaService);

  readonly resumen = signal<ResumenRepos | undefined>(undefined);
  readonly cargando = signal(false);
  readonly error = signal<string | undefined>(undefined);

  constructor() {
    this.ia.repos().subscribe({
      next: (r) => this.resumen.set(r.resumen),
      error: () => undefined
    });
  }

  regenerar(): void {
    this.cargando.set(true);
    this.error.set(undefined);
    this.ia.generarRepos().subscribe({
      next: (r) => {
        this.resumen.set(r.resumen);
        this.cargando.set(false);
      },
      error: (e: unknown) => {
        this.error.set(describirError(e));
        this.cargando.set(false);
      }
    });
  }
}
