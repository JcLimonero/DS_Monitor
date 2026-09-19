import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { IconComponent } from '../../ui/icon.component';

/**
 * Descarga un respaldo completo de lo que guarda el puente (la base de
 * datos): pendientes, anotaciones, equipo, ejecuciones, credenciales de
 * buzones e integraciones. Es un archivo JSON con secretos: se guarda con
 * cuidado.
 */
@Component({
  selector: 'pt-respaldo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section class="card card-pad mt-4">
      <h2 class="text-sm font-semibold text-ink">Respaldo de datos</h2>
      <p class="mt-1 max-w-3xl text-sm text-ink-muted">
        Baja una copia de todo lo que guarda el monitor en su base de datos
        (pendientes, trazabilidad, equipo, ejecuciones y las credenciales
        capturadas aquí). Es un JSON con secretos: guárdalo en un lugar seguro.
        Render respalda la base a diario; esto es tu copia aparte.
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn"
          [disabled]="ocupado()"
          (click)="descargar()">
          <pt-icon name="bandeja" class="h-4 w-4" />
          {{ ocupado() ? 'Preparando…' : 'Descargar respaldo' }}
        </button>
        @if (mensaje(); as m) {
          <span class="text-xs text-ink-muted">{{ m }}</span>
        }
      </div>
    </section>
  `
})
export class RespaldoComponent {
  private readonly admin = inject(PuenteAdminService);
  readonly ocupado = signal(false);
  readonly mensaje = signal<string | undefined>(undefined);

  descargar(): void {
    this.ocupado.set(true);
    this.mensaje.set(undefined);
    this.admin.respaldo().subscribe({
      next: (datos) => {
        const blob = new Blob([JSON.stringify(datos, null, 2)], {
          type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ds-monitor-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        const total = Object.values(datos.colecciones).reduce(
          (n, c) => n + Object.keys(c).length,
          0
        );
        this.mensaje.set(`${total} documentos, desde ${datos.origen}.`);
        this.ocupado.set(false);
      },
      error: (e: unknown) => {
        const http = e as { error?: { error?: string }; message?: string };
        this.mensaje.set(http?.error?.error ?? http?.message ?? 'No se pudo.');
        this.ocupado.set(false);
      }
    });
  }
}
