import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AjustesPortalService } from '../../core/config/ajustes-portal.service';

/**
 * Avisos de los ajustes compartidos, arriba de Integraciones:
 *
 * - Este navegador trae ajustes viejos (buzones, fuentes apagadas, modos) y el
 *   servidor está vacío: se ofrece subirlos. Nada se sube sin el clic.
 * - El servidor ya tiene ajustes (mandan esos) y el navegador trae otros: se
 *   ofrece descartarlos, nunca pisar los del servidor.
 * - Se cambió algo que los adaptadores toman al recargar.
 */
@Component({
  selector: 'pt-ajustes-aviso',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ajustes.migracion(); as modo) {
      <section
        class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
        role="status">
        @if (modo === 'subir') {
          <p class="font-medium">
            Este navegador tiene ajustes guardados que el servidor no conoce.
          </p>
          <p class="mt-1 text-xs">
            Buzones agregados, fuentes apagadas o conexiones en datos reales que
            se guardaron aquí. Si los subes, los verán también el carrusel y el
            celular.
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary"
              [disabled]="ajustes.migrando()"
              (click)="subir()">
              Subir los ajustes de este navegador al servidor
            </button>
          </div>
        } @else {
          <p class="font-medium">
            El servidor ya tiene ajustes compartidos; los de este navegador
            quedan sin uso.
          </p>
          <p class="mt-1 text-xs">
            Mandan los del servidor. Puedes descartar lo que este navegador
            guardó, o dejarlo como está.
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" class="btn" (click)="descartar()">
              Descartar los ajustes de este navegador
            </button>
          </div>
        }
        @if (ajustes.errorMigracion(); as error) {
          <p class="mt-2 text-xs text-rose-700 dark:text-rose-300">
            {{ error }}
          </p>
        }
      </section>
    }
    @if (ajustes.subidoAlGuardar()) {
      <section
        class="mb-4 rounded-lg bg-surface-muted p-3 text-sm text-ink"
        role="status">
        <p>Los ajustes de este navegador se subieron al servidor.</p>
      </section>
    }
    @if (ajustes.pendienteRecarga()) {
      <section
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted p-3 text-sm text-ink"
        role="status">
        <p>Los cambios en fuentes y buzones se aplican al recargar.</p>
        <button type="button" class="btn" (click)="recargar()">Recargar</button>
      </section>
    }
  `
})
export class AjustesAvisoComponent {
  readonly ajustes = inject(AjustesPortalService);

  subir(): void {
    this.ajustes.subirLocales().subscribe({
      next: () => location.reload(),
      error: (error: unknown) => {
        this.ajustes.migrando.set(false);
        this.ajustes.errorMigracion.set(describir(error));
      }
    });
  }

  descartar(): void {
    this.ajustes.descartarLocales();
    location.reload();
  }

  recargar(): void {
    location.reload();
  }
}

function describir(error: unknown): string {
  const http = error as {
    status?: number;
    error?: { error?: string };
    message?: string;
  };
  if (http?.error?.error) {
    return http.error.error;
  }
  return http?.status === 0
    ? 'No se pudo llegar al servidor.'
    : (http?.message ?? String(error));
}
