import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AvisosService } from '../core/avisos/avisos.service';
import { TaskItem } from '../core/models';
import { LocalTaskStore } from '../core/sources/local/local-task.store';
import { PortalStore } from '../core/state/portal.store';
import { IconComponent } from './icon.component';
import { TaskCardComponent } from './task-card.component';

/**
 * El diálogo no puede vivir dentro de la campana: la cabecera tiene
 * backdrop-blur y eso hace que un `fixed` se mida contra la barra, no contra
 * la pantalla. El host se mueve a `document.body` para centrarlo de verdad.
 */
@Component({
  selector: 'pt-aviso-dialogo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink, TaskCardComponent],
  template: `
    @if (avisos.dialogoId(); as id) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
        (click)="cerrar()">
        <div
          class="card flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialogo-aviso-titulo"
          (click)="$event.stopPropagation()">
          <header
            class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 sm:px-5">
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
                (click)="cerrar()">
                Ver en Pendientes →
              </a>
            }
            <button
              type="button"
              class="flex h-11 w-11 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink"
              [class.ml-auto]="kiosco()"
              aria-label="Cerrar"
              (click)="cerrar()">
              <pt-icon name="cerrar" class="h-5 w-5" />
            </button>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            @if (pendienteDialogo(); as tarea) {
              <pt-task-card [task]="tarea" [abierta]="true" />
            } @else if (!store.tareasListas()) {
              <p class="text-sm text-ink-muted">Cargando el pendiente…</p>
            } @else if (avisoDialogo(); as aviso) {
              <h3 class="text-base font-semibold text-ink">
                {{ aviso.titulo }}
              </h3>
              <p class="mt-2 text-sm text-ink-muted">
                {{ aviso.persona }}
                {{ aviso.accion ?? 'actualizó este pendiente' }}
                @if (aviso.texto) {
                  · “{{ aviso.texto }}”
                }
              </p>
              <p class="mt-3 text-sm text-ink-subtle">
                Ya no está en la lista (se archivó o se fusionó con otro).
              </p>
            } @else {
              <p class="text-sm text-ink-muted">No encontré ese pendiente.</p>
            }
          </div>
        </div>
      </div>
    }
  `
})
export class AvisoDialogoComponent {
  readonly kiosco = input(false);

  readonly avisos = inject(AvisosService);
  readonly store = inject(PortalStore);
  private readonly locales = inject(LocalTaskStore);
  private readonly router = inject(Router);
  private readonly dialogoRespaldo = signal<TaskItem | undefined>(undefined);

  private readonly tareaEnStore = computed(() => {
    const id = this.avisos.dialogoId();
    if (!id) {
      return undefined;
    }
    const listas = [this.store.tasksTodas(), this.locales.tasks()];
    for (const lista of listas) {
      const exacta = lista.find((t) => t.id === id);
      if (exacta) {
        return exacta;
      }
    }
    const titulo = this.avisos
      .avisos()
      .find((a) => a.tareaId === id)
      ?.titulo?.trim();
    if (!titulo) {
      return undefined;
    }
    return listas
      .flat()
      .filter((t) => t.title.trim() === titulo)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  });

  readonly avisoDialogo = computed(() => {
    const id = this.avisos.dialogoId();
    return id ? this.avisos.avisos().find((a) => a.tareaId === id) : undefined;
  });

  readonly pendienteDialogo = computed(() =>
    this.avisos.dialogoId()
      ? (this.tareaEnStore() ?? this.dialogoRespaldo())
      : undefined
  );

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    afterNextRender(() => {
      if (host.nativeElement.parentElement !== document.body) {
        document.body.appendChild(host.nativeElement);
      }
    });
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

  cerrar(): void {
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
