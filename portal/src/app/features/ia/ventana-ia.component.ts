import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injectable,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { IaService, describirError } from '../../core/ia/ia.service';
import { IconComponent } from '../../ui/icon.component';

interface Turno {
  rol: 'usuario' | 'asistente';
  texto: string;
}

/** Si la ventana está abierta; lo comparten el botón de la cabecera y el panel. */
@Injectable({ providedIn: 'root' })
export class VentanaIaEstado {
  readonly abierta = signal(false);
}

/**
 * El botón de la cabecera que abre la ventana. Va separado del panel porque
 * la cabecera lleva backdrop-blur, y eso vuelve al `fixed` del panel relativo
 * a ella: el panel se monta en la raíz del shell.
 */
@Component({
  selector: 'pt-ventana-ia-boton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="btn px-2 py-1.5"
      aria-label="Abrir la ventana de la IA"
      title="Pedirle algo a la IA"
      (click)="estado.abierta.set(!estado.abierta())">
      <span class="text-base leading-none">✦</span>
      <span class="hidden text-xs sm:inline">IA</span>
    </button>
  `
})
export class VentanaIaBotonComponent {
  readonly estado = inject(VentanaIaEstado);
}

/**
 * La ventana de la IA: un panel lateral para preguntarle lo que sea sobre
 * el tablero ("¿qué vence esta semana de Dealer?", "redáctame un mensaje
 * para Vanguardia con los tres temas") o pedir los resúmenes largos. La
 * conversación vive en esta pestaña; al cerrar se conserva, al recargar no.
 */
@Component({
  selector: 'pt-ventana-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
  styles: `
    @keyframes ia-punto {
      0%,
      80%,
      100% {
        opacity: 0.35;
        transform: translateY(0);
      }
      40% {
        opacity: 1;
        transform: translateY(-3px);
      }
    }
    .ia-pensando-punto {
      animation: ia-punto 1.1s ease-in-out infinite;
    }
    .ia-pensando-punto:nth-child(2) {
      animation-delay: 0.15s;
    }
    .ia-pensando-punto:nth-child(3) {
      animation-delay: 0.3s;
    }
    @keyframes ia-brillo {
      0%,
      100% {
        opacity: 0.55;
      }
      50% {
        opacity: 1;
      }
    }
    .ia-pensando-texto {
      animation: ia-brillo 1.6s ease-in-out infinite;
    }
  `,
  template: `
    @if (abierta()) {
      <div
        class="fixed inset-0 z-30 bg-black/30"
        (click)="abierta.set(false)"></div>
      <aside
        class="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl"
        role="dialog"
        aria-label="Ventana de la IA">
        <header class="flex items-center gap-2 border-b border-line px-4 py-3">
          <span class="text-lg leading-none text-brand">✦</span>
          <h2 class="text-sm font-semibold text-ink">Pregúntale al monitor</h2>
          <button
            type="button"
            class="ml-auto rounded p-1 text-ink-subtle hover:bg-surface-muted hover:text-ink"
            aria-label="Cerrar"
            (click)="abierta.set(false)">
            <pt-icon name="cerrar" class="h-4 w-4" />
          </button>
        </header>

        @if (!ia.activa()) {
          <p class="p-4 text-sm text-ink-muted">
            La IA no está activa: captura la API key de OpenRouter en
            Integraciones → IA.
          </p>
        } @else {
          <div class="flex flex-wrap gap-1 border-b border-line px-3 py-2">
            @for (s of sugerencias; track s) {
              <button
                type="button"
                class="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-muted"
                [disabled]="ocupado()"
                (click)="enviar(s)">
                {{ s }}
              </button>
            }
            <button
              type="button"
              class="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-muted"
              [disabled]="ocupado()"
              (click)="pedir('resumen')">
              Resumen del día →
            </button>
            <button
              type="button"
              class="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-muted"
              [disabled]="ocupado()"
              (click)="pedir('repos')">
              Semana en repos →
            </button>
            <button
              type="button"
              class="rounded-full border border-line px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-muted"
              [disabled]="ocupado()"
              (click)="pedir('diagnosticos')">
              Diagnóstico →
            </button>
          </div>

          <div #hilo class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            @if (turnos().length === 0) {
              <p class="text-sm text-ink-muted">
                Pregunta sobre pendientes, juntas, equipo, licencias o sitios; o
                pide una redacción. Solo usa lo que hay en el tablero.
              </p>
            }
            @for (t of turnos(); track $index) {
              <div
                class="max-w-[92%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm"
                [class]="
                  t.rol === 'usuario'
                    ? 'ml-auto bg-brand text-white'
                    : 'bg-surface-muted text-ink'
                ">
                {{ t.texto }}
              </div>
            }
            @if (ocupado()) {
              <div
                class="inline-flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2"
                role="status"
                aria-live="polite"
                aria-label="Pensando">
                <span class="text-brand ia-pensando-texto" aria-hidden="true"
                  >✦</span
                >
                <span class="text-xs text-ink-muted ia-pensando-texto"
                  >Pensando</span
                >
                <span class="inline-flex gap-1" aria-hidden="true">
                  <span
                    class="ia-pensando-punto h-1.5 w-1.5 rounded-full bg-brand"></span>
                  <span
                    class="ia-pensando-punto h-1.5 w-1.5 rounded-full bg-brand"></span>
                  <span
                    class="ia-pensando-punto h-1.5 w-1.5 rounded-full bg-brand"></span>
                </span>
              </div>
            }
            @if (error(); as e) {
              <p class="text-xs text-danger">{{ e }}</p>
            }
          </div>

          <form
            class="flex gap-2 border-t border-line p-3"
            (ngSubmit)="enviar()">
            <input
              class="field min-w-0 flex-1"
              type="text"
              name="pregunta"
              placeholder="¿Qué vence esta semana de Dealer?"
              autocomplete="off"
              [ngModel]="texto()"
              (ngModelChange)="texto.set($event)" />
            <button
              type="submit"
              class="btn btn-primary shrink-0"
              [disabled]="ocupado() || !texto().trim()">
              Enviar
            </button>
            @if (turnos().length > 0) {
              <button
                type="button"
                class="btn shrink-0"
                title="Empezar de nuevo"
                (click)="turnos.set([])">
                Limpiar
              </button>
            }
          </form>
        }
      </aside>
    }
  `
})
export class VentanaIaComponent {
  readonly ia = inject(IaService);
  private readonly router = inject(Router);
  private readonly hilo = viewChild<ElementRef<HTMLDivElement>>('hilo');

  readonly abierta = inject(VentanaIaEstado).abierta;
  readonly texto = signal('');
  readonly turnos = signal<Turno[]>([]);
  readonly ocupado = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly sugerencias = [
    '¿Qué vence esta semana?',
    '¿Qué tiene asignado cada quien?',
    '¿Qué está sin asignar y es urgente?'
  ];

  enviar(pregunta = this.texto().trim()): void {
    if (!pregunta || this.ocupado()) {
      return;
    }
    this.texto.set('');
    this.error.set(undefined);
    const conversacion: Turno[] = [
      ...this.turnos(),
      { rol: 'usuario', texto: pregunta }
    ];
    this.turnos.set(conversacion);
    this.ocupado.set(true);
    this.bajar();
    this.ia.preguntar(conversacion).subscribe({
      next: (r) => {
        this.turnos.update((t) => [
          ...t,
          { rol: 'asistente', texto: r.respuesta }
        ]);
        this.ocupado.set(false);
        this.bajar();
      },
      error: (e: unknown) => {
        this.error.set(describirError(e));
        this.ocupado.set(false);
      }
    });
  }

  /** Los resúmenes largos siguen viviendo en su pantalla; se piden desde aquí. */
  pedir(que: 'resumen' | 'repos' | 'diagnosticos'): void {
    const llamada: Observable<unknown> =
      que === 'resumen'
        ? this.ia.generarResumen()
        : que === 'repos'
          ? this.ia.generarRepos()
          : this.ia.generarDiagnosticos();
    const ruta =
      que === 'resumen' ? '/hoy' : que === 'repos' ? '/repos' : '/monitoreo';
    this.ocupado.set(true);
    this.error.set(undefined);
    llamada.subscribe({
      next: () => {
        this.ocupado.set(false);
        this.abierta.set(false);
        void this.router.navigateByUrl(`${ruta}?ia=${Date.now()}`);
      },
      error: (e: unknown) => {
        this.error.set(describirError(e));
        this.ocupado.set(false);
      }
    });
  }

  private bajar(): void {
    setTimeout(() => {
      const el = this.hilo()?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }
}
