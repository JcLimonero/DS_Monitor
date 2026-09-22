import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output
} from '@angular/core';
import { IconComponent } from './icon.component';

/** Clase en <html> para que el fondo no se mueva detras del overlay. */
const CLASE_HTML = 'con-dialogo-portal';

let seq = 0;

/**
 * Overlay de alta/edicion: en el celular es una hoja a pantalla completa; desde
 * lg, una ventana centrada. Clic fuera, Escape o el boton lo cierran. El
 * contenido se proyecta (`ng-content`); el pie opcional lleva `.dialogo-pie`.
 *
 * El host se mueve a `document.body` para que el overlay (z-50) quede encima
 * del nav sticky de Integraciones (z-10) y no se quede atrapado en la columna.
 */
@Component({
  selector: 'pt-dialogo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    '(document:keydown.escape)': 'pedirCerrar()'
  },
  template: `
    <div
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 lg:items-center lg:p-6"
      (click)="pedirCerrar()">
      <div
        class="card flex h-full w-full max-w-2xl flex-col rounded-none lg:h-auto lg:max-h-[90dvh] lg:rounded-xl"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="tituloId"
        (click)="$event.stopPropagation()">
        <header
          class="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2 lg:px-5">
          <h2 [id]="tituloId" class="text-sm font-semibold text-ink">
            {{ titulo() }}
          </h2>
          <button
            type="button"
            class="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-ink-subtle hover:bg-surface-muted hover:text-ink"
            aria-label="Cerrar"
            (click)="pedirCerrar()">
            <pt-icon name="cerrar" class="h-5 w-5" />
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
          <ng-content />
        </div>
        <div
          class="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3 empty:hidden lg:px-5">
          <ng-content select=".dialogo-pie" />
        </div>
      </div>
    </div>
  `
})
export class DialogoComponent {
  readonly titulo = input.required<string>();
  readonly cerrar = output<void>();

  readonly tituloId = `dialogo-titulo-${++seq}`;

  constructor() {
    const host = inject(ElementRef<HTMLElement>);
    document.documentElement.classList.add(CLASE_HTML);
    inject(DestroyRef).onDestroy(() =>
      document.documentElement.classList.remove(CLASE_HTML)
    );
    afterNextRender(() => {
      document.body.appendChild(host.nativeElement);
      const primero = host.nativeElement.querySelector(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
      ) as HTMLElement | null;
      primero?.focus();
    });
  }

  pedirCerrar(): void {
    this.cerrar.emit();
  }
}
