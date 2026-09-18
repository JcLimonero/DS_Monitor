import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { Router } from '@angular/router';
import { IaService, describirError } from '../../core/ia/ia.service';
import { IconComponent } from '../../ui/icon.component';

/**
 * El botón de ayuda: lo que la IA hace sola (correo, juntas de Fireflies y
 * dictado) y lo que solo hace cuando se lo pides desde aquí: resumen del
 * día, semana en los repos y diagnóstico de caídas.
 */
@Component({
  selector: 'pt-ayuda-ia',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="relative">
      <button
        type="button"
        class="btn px-2 py-1.5"
        aria-label="Ayuda de la IA"
        title="Pedirle algo a la IA"
        (click)="abierto.set(!abierto())">
        <span class="text-base leading-none">✦</span>
        <span class="hidden text-xs sm:inline">Ayuda</span>
      </button>
      @if (abierto()) {
        <div class="fixed inset-0 z-30" (click)="abierto.set(false)"></div>
        <div
          class="absolute right-0 z-40 mt-2 w-[min(92vw,22rem)] rounded-lg border border-line bg-surface p-3 shadow-lg">
          <p class="text-xs font-bold uppercase tracking-wide text-ink-subtle">
            Pedirle a la IA
          </p>
          @if (!ia.activa()) {
            <p class="mt-2 text-sm text-ink-muted">
              La IA no está activa: captura la API key de OpenRouter en Equipo →
              Configuración.
            </p>
          } @else {
            <div class="mt-2 grid gap-2">
              <button
                type="button"
                class="btn justify-start"
                [disabled]="ocupado()"
                (click)="resumen()">
                <pt-icon name="panel" class="h-4 w-4" />
                Resumen del día (ayer, hoy y lo que viene)
              </button>
              <button
                type="button"
                class="btn justify-start"
                [disabled]="ocupado()"
                (click)="repos()">
                <pt-icon name="rama" class="h-4 w-4" />
                La semana en los repositorios
              </button>
              <button
                type="button"
                class="btn justify-start"
                [disabled]="ocupado()"
                (click)="diagnosticos()">
                <pt-icon name="monitoreo" class="h-4 w-4" />
                Diagnóstico de sitios caídos y despliegues
              </button>
            </div>
            @if (mensaje(); as m) {
              <p class="mt-2 text-xs text-ink-muted">{{ m }}</p>
            }
          }
          <p class="mt-3 border-t border-line pt-2 text-xs text-ink-subtle">
            Sola, la IA solo trabaja en tres cosas: clasificar el correo que
            llega, sacar acuerdos de las juntas de Fireflies y entender lo que
            dictas (voz o Telegram). Todo lo demás, solo desde aquí.
          </p>
        </div>
      }
    </div>
  `
})
export class AyudaIaComponent {
  readonly ia = inject(IaService);
  private readonly router = inject(Router);
  readonly abierto = signal(false);
  readonly ocupado = signal(false);
  readonly mensaje = signal<string | undefined>(undefined);

  resumen(): void {
    this.pedir(this.ia.generarResumen(), '/hoy', 'Resumen listo en Hoy.');
  }

  repos(): void {
    this.pedir(
      this.ia.generarRepos(),
      '/repos',
      'Resumen listo en Repositorios.'
    );
  }

  diagnosticos(): void {
    this.pedir(
      this.ia.generarDiagnosticos(),
      '/monitoreo',
      'Diagnóstico listo en Monitoreo.'
    );
  }

  private pedir(
    llamada: {
      subscribe: (o: {
        next: () => void;
        error: (e: unknown) => void;
      }) => unknown;
    },
    ruta: string,
    listo: string
  ): void {
    this.ocupado.set(true);
    this.mensaje.set('Pidiendo…');
    llamada.subscribe({
      next: () => {
        this.ocupado.set(false);
        this.mensaje.set(listo);
        this.abierto.set(false);
        void this.router.navigateByUrl(ruta + '?ia=' + Date.now());
      },
      error: (e: unknown) => {
        this.ocupado.set(false);
        this.mensaje.set(describirError(e));
      }
    });
  }
}
