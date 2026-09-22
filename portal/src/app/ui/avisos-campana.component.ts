import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Aviso, AvisosService } from '../core/avisos/avisos.service';
import { Meeting, TaskItem } from '../core/models';
import { LocalTaskStore } from '../core/sources/local/local-task.store';
import { PortalStore } from '../core/state/portal.store';
import { IconComponent } from './icon.component';
import { RelativePipe, TimePipe } from './portal.pipes';
import { TaskCardComponent } from './task-card.component';

/** Minutos que dura el aviso de «junta iniciada» desde el start. */
const JUNTA_AVISO_MIN = 15;

/**
 * Campana de movimientos del equipo (y juntas que acaban de iniciar).
 * Sirve en el shell y en el carrusel del monitor.
 */
@Component({
  selector: 'pt-avisos-campana',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    RelativePipe,
    RouterLink,
    TaskCardComponent,
    TimePipe
  ],
  template: `
    <div class="relative">
      <button
        type="button"
        class="btn relative px-2 py-1.5"
        [class.h-12]="tv()"
        [class.w-12]="tv()"
        [class.text-base]="tv()"
        aria-label="Avisos del equipo"
        (click)="alternar()">
        <pt-icon name="alerta" [class]="tv() ? 'h-6 w-6' : 'h-4 w-4'" />
        @if (badge() > 0) {
          <span
            class="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
            [class.h-6]="tv()"
            [class.min-w-6]="tv()"
            [class.text-xs]="tv()">
            {{ badge() }}
          </span>
        }
      </button>
      @if (panelAbierto()) {
        <div class="fixed inset-0 z-30" (click)="cerrarPanel()"></div>
        <div
          class="absolute right-0 z-40 mt-2 rounded-lg border border-line bg-surface p-2 shadow-lg"
          [class]="
            tv() ? 'w-[min(92vw,28rem)] text-base' : 'w-[min(92vw,22rem)]'
          ">
          <div class="flex items-center justify-between px-2 py-1">
            <p
              class="text-xs font-bold uppercase tracking-wide text-ink-subtle"
              [class.text-sm]="tv()">
              Movimientos del equipo
            </p>
            @if (avisos.noLeidos() > 0) {
              <button
                type="button"
                class="text-xs text-brand hover:underline"
                [class.text-sm]="tv()"
                (click)="avisos.marcarLeidos()">
                Marcar todo leído
              </button>
            }
          </div>
          @if (juntasIniciadas().length === 0 && avisos.avisos().length === 0) {
            <p
              class="px-2 py-3 text-sm text-ink-muted"
              [class.text-base]="tv()">
              Sin movimientos todavía.
            </p>
          }
          <ul class="max-h-96 overflow-y-auto">
            @for (j of juntasIniciadas(); track claveJunta(j)) {
              <li
                class="flex items-stretch gap-1 rounded bg-amber-50 dark:bg-amber-500/10">
                <button
                  type="button"
                  class="min-w-0 flex-1 rounded px-2 py-2 text-left transition hover:bg-surface-muted/60"
                  (click)="irAJunta(j)">
                  <p class="text-sm text-ink" [class.text-base]="tv()">
                    <span class="font-medium">Junta iniciada</span>
                    ·
                    <span class="font-medium">{{ j.title }}</span>
                  </p>
                  <p class="text-xs text-ink-muted" [class.text-sm]="tv()">
                    Desde las {{ j.start | hora }} · × para quitar · se va sola
                    en {{ minutosRestantes(j) }} min
                  </p>
                </button>
                <button
                  type="button"
                  class="flex shrink-0 items-center justify-center rounded px-3 text-ink-subtle transition hover:bg-surface-muted hover:text-ink"
                  [class.px-4]="tv()"
                  [attr.aria-label]="'Quitar aviso de ' + j.title"
                  title="Quitar aviso"
                  (click)="quitarJunta(j, $event)">
                  <pt-icon
                    name="cerrar"
                    [class]="tv() ? 'h-6 w-6' : 'h-4 w-4'" />
                </button>
              </li>
            }
            @for (a of avisos.avisos().slice(0, 30); track a.id) {
              <li>
                <button
                  type="button"
                  class="w-full rounded px-2 py-2 text-left transition hover:bg-surface-muted"
                  [class.bg-brand-soft]="!a.leido"
                  (click)="irAlAviso(a)">
                  <p class="text-sm text-ink" [class.text-base]="tv()">
                    <span class="font-medium">{{ a.persona }}</span>
                    {{
                      a.accion ??
                        (a.tipo === 'termino'
                          ? 'terminó'
                          : a.tipo === 'reabrio'
                            ? 'reabrió'
                            : 'comentó')
                    }}
                    <span class="font-medium">{{ a.titulo }}</span>
                  </p>
                  @if (a.texto) {
                    <p class="text-xs text-ink-muted" [class.text-sm]="tv()">
                      “{{ a.texto }}”
                    </p>
                  }
                  <p class="text-xs text-ink-subtle" [class.text-sm]="tv()">
                    {{ a.en | relativo }}
                  </p>
                </button>
              </li>
            }
          </ul>
        </div>
      }
    </div>

    @if (avisos.dialogoId(); as id) {
      <div
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 lg:items-center lg:p-6"
        (click)="cerrarDialogo()">
        <div
          class="card flex h-full w-full max-w-3xl flex-col rounded-none lg:h-auto lg:max-h-[90dvh] lg:rounded-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialogo-aviso-titulo"
          (click)="$event.stopPropagation()">
          <header
            class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 lg:px-5">
            <h2
              id="dialogo-aviso-titulo"
              class="text-sm font-semibold text-ink">
              Pendiente
            </h2>
            @if (!kiosco()) {
              <a
                class="ml-auto text-sm font-semibold text-brand hover:underline"
                routerLink="/pendientes"
                [queryParams]="{ abrir: id }"
                (click)="cerrarDialogo()">
                Ver en Pendientes →
              </a>
            }
            <button
              type="button"
              class="flex h-11 w-11 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink"
              [class.ml-auto]="kiosco()"
              aria-label="Cerrar"
              (click)="cerrarDialogo()">
              <pt-icon name="cerrar" class="h-5 w-5" />
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
            @if (pendienteDialogo(); as tarea) {
              <pt-task-card [task]="tarea" />
            } @else {
              <p class="text-sm text-ink-muted">Cargando el pendiente…</p>
            }
          </div>
        </div>
      </div>
    }
  `
})
export class AvisosCampanaComponent {
  /** En el monitor: no navega fuera del carrusel. */
  readonly kiosco = input(false);
  /** Botón e iconos más grandes para televisión. */
  readonly tv = input(false);

  readonly avisos = inject(AvisosService);
  private readonly store = inject(PortalStore);
  private readonly locales = inject(LocalTaskStore);
  private readonly router = inject(Router);

  readonly panelAbierto = signal(false);
  readonly ahora = signal(new Date());
  private readonly dialogoRespaldo = signal<TaskItem | undefined>(undefined);
  /** Juntas cuyo aviso se quitó a mano; clave = id|inicio. */
  private readonly juntasQuitadas = signal<ReadonlySet<string>>(new Set());

  private readonly tareaEnStore = computed(() => {
    const id = this.avisos.dialogoId();
    if (!id) {
      return undefined;
    }
    return (
      this.store.tasks().find((t) => t.id === id) ??
      this.locales.tasks().find((t) => t.id === id)
    );
  });

  readonly pendienteDialogo = computed(() =>
    this.avisos.dialogoId()
      ? (this.tareaEnStore() ?? this.dialogoRespaldo())
      : undefined
  );

  /**
   * Juntas que ya empezaron y llevan menos de 15 minutos: aviso temporal
   * que desaparece solo al cumplir ese plazo (o al quitarlo a mano).
   */
  readonly juntasIniciadas = computed(() => {
    const t = this.ahora().getTime();
    const limite = JUNTA_AVISO_MIN * 60_000;
    const quitadas = this.juntasQuitadas();
    return this.store
      .meetings()
      .filter((m) => {
        if (m.status === 'cancelada' || m.allDay) {
          return false;
        }
        if (quitadas.has(this.claveJunta(m))) {
          return false;
        }
        const inicio = Date.parse(m.start);
        if (!Number.isFinite(inicio)) {
          return false;
        }
        return inicio <= t && t < inicio + limite;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  });

  readonly badge = computed(
    () => this.avisos.noLeidos() + this.juntasIniciadas().length
  );

  /** Panel o diálogo abiertos: el carrusel no debe avanzar. */
  readonly ocupado = computed(
    () => this.panelAbierto() || !!this.avisos.dialogoId()
  );

  constructor() {
    interval(15_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.ahora.set(new Date()));
    effect(() => {
      const tarea = this.tareaEnStore();
      if (tarea) {
        this.dialogoRespaldo.set(tarea);
      }
    });
    effect(() => {
      const id = this.avisos.dialogoId();
      if (id && !this.tareaEnStore() && !this.dialogoRespaldo()) {
        this.store.refreshTasks();
      }
    });
  }

  alternar(): void {
    this.panelAbierto.update((v) => !v);
  }

  cerrarPanel(): void {
    this.panelAbierto.set(false);
  }

  /** Minutos que faltan para que caduque el aviso de la junta. */
  minutosRestantes(j: Meeting): number {
    const fin = Date.parse(j.start) + JUNTA_AVISO_MIN * 60_000;
    return Math.max(1, Math.ceil((fin - this.ahora().getTime()) / 60_000));
  }

  /** Id + inicio: la misma junta otro día puede avisar de nuevo. */
  claveJunta(j: Meeting): string {
    return `${j.id}|${j.start}`;
  }

  /** Quita el aviso al instante (un toque); no cancela la junta. */
  quitarJunta(j: Meeting, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    const clave = this.claveJunta(j);
    this.juntasQuitadas.update((prev) => {
      const next = new Set(prev);
      next.add(clave);
      return next;
    });
  }

  irAJunta(j: Meeting): void {
    this.cerrarPanel();
    if (j.joinUrl) {
      window.open(j.joinUrl, '_blank', 'noopener');
      return;
    }
    if (!this.kiosco()) {
      void this.router.navigate(['/agenda']);
    }
  }

  irAlAviso(a: Aviso): void {
    this.avisos.marcarLeidos([a.id]);
    this.cerrarPanel();
    if (a.tipo === 'sistema' || !a.tareaId) {
      if (!this.kiosco()) {
        void this.router.navigate(['/pendientes'], {
          queryParams: { owner: 'nadie' }
        });
      }
      return;
    }
    this.dialogoRespaldo.set(undefined);
    this.avisos.abrirEnDialogo(a.tareaId);
    if (!this.kiosco()) {
      void this.router.navigate(['/pendientes'], {
        queryParams: { abrir: a.tareaId }
      });
    }
  }

  cerrarDialogo(): void {
    this.avisos.cerrarDialogo();
    this.dialogoRespaldo.set(undefined);
    if (!this.kiosco()) {
      void this.router.navigate([], {
        queryParams: { abrir: null },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
  }
}
