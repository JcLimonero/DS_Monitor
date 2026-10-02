import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { LicenciasService } from '../core/licencias/licencias.service';
import { plural } from '../core/util/text.util';
import { IconComponent } from './icon.component';

/**
 * Aviso de una sola vez: las licencias a mano y las correcciones se guardaban
 * en cada navegador; ahora viven en el puente. Si este navegador trae algo que
 * el servidor no tiene, se ve provisionalmente y se ofrece subirlo. No se borra
 * nada sin ese clic, y lo que no se pueda subir se queda aquí.
 *
 * `compacto` es la versión de una línea para la pantalla del carrusel.
 */
@Component({
  selector: 'pt-licencias-migracion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (service.pendientesDeSubir() > 0) {
      @if (compacto()) {
        <p
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-warn">
          <span class="flex items-center gap-1.5">
            <pt-icon name="alerta" class="h-4 w-4 shrink-0" />
            {{ plural(service.pendientesDeSubir(), 'licencia') }} solo en este
            navegador
          </span>
          <button
            type="button"
            class="btn !h-[44px]"
            [disabled]="subiendo()"
            (click)="subir()">
            Subir al servidor
          </button>
          @if (error()) {
            <span class="text-danger" role="alert">No se pudo subir</span>
          }
        </p>
      } @else {
        <div class="banner banner-warn mb-4 flex-wrap" role="status">
          <pt-icon name="alerta" class="h-4 w-4 shrink-0" />
          <span class="min-w-0 flex-1">
            Este navegador tiene
            {{ plural(service.pendientesDeSubir(), 'elemento') }} (licencias a
            mano o correcciones) que el servidor no tiene. Se ven aquí con la
            marca «Solo en este navegador», pero los demás dispositivos, como la
            pantalla del carrusel, no los ven.
            @if (error(); as e) {
              <span class="block font-semibold">{{ e }}</span>
            }
          </span>
          <button
            type="button"
            class="btn shrink-0"
            [disabled]="subiendo()"
            (click)="subir()">
            Subir lo capturado en este navegador al servidor
          </button>
        </div>
      }
    }

    @if (!compacto() && resumen(); as r) {
      <div
        class="mb-4 flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm"
        [class]="
          r.descartadas.length > 0
            ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
            : 'border-line bg-surface text-ink'
        "
        role="status">
        <p class="min-w-0 flex-1">
          Se subieron {{ r.migradas }}; {{ conCamposCorregidos() }} con campos
          corregidos;
          {{ r.descartadas.length }}
          {{
            r.descartadas.length === 1
              ? 'no se pudo subir'
              : 'no se pudieron subir'
          }}.
          @if (r.saneadas.length > 0) {
            <span class="mt-1 block text-xs">
              Corregido:
              @for (s of r.saneadas; track $index) {
                {{ s.id }} ({{ s.campo }}: {{ s.motivo }}){{
                  $last ? '.' : '; '
                }}
              }
            </span>
          }
          @if (r.conflictos.length > 0) {
            <span class="mt-1 block text-xs">
              {{ conflictosRegistros() }}
              {{
                conflictosRegistros() === 1
                  ? 'licencia ya existía'
                  : 'licencias ya existían'
              }}
              en el servidor con otros datos (se conservó la del servidor):
              @for (c of r.conflictos; track $index) {
                {{ c.producto }}, {{ c.campo }}: aquí {{ c.local }}, servidor
                {{ c.servidor }}{{ $last ? '.' : '; ' }}
              }
            </span>
          }
          @if (r.descartadas.length > 0) {
            <span class="mt-1 block text-xs font-semibold">
              No se subieron (siguen en este navegador):
              @for (d of r.descartadas; track $index) {
                {{ d.id }} ({{ d.motivo }}){{ $last ? '.' : '; ' }}
              }
            </span>
          }
        </p>
        <div class="flex shrink-0 flex-wrap gap-2">
          @if (r.descartadas.length > 0) {
            <button
              type="button"
              class="btn"
              (click)="service.descartarLoQueNoSubio()">
              Descartar lo que no se subió
            </button>
          }
          <button
            type="button"
            class="btn"
            (click)="service.cerrarResumenDeSubida()">
            Entendido
          </button>
        </div>
      </div>
    }
  `
})
export class LicenciasMigracionComponent {
  protected readonly service = inject(LicenciasService);
  protected readonly plural = plural;
  readonly compacto = input(false);
  readonly subiendo = signal(false);
  readonly error = signal<string | undefined>(undefined);

  protected readonly resumen = this.service.ultimaSubida;

  /** Registros distintos que traían algún campo corregido. */
  protected readonly conCamposCorregidos = computed(
    () => new Set((this.resumen()?.saneadas ?? []).map((s) => s.id)).size
  );

  /** Registros distintos con algún dato que difería del servidor. */
  protected readonly conflictosRegistros = computed(
    () => new Set((this.resumen()?.conflictos ?? []).map((c) => c.id)).size
  );

  subir(): void {
    this.subiendo.set(true);
    this.error.set(undefined);
    this.service.subirLoDeEsteNavegador().subscribe({
      next: () => this.subiendo.set(false),
      error: (e: unknown) => {
        this.subiendo.set(false);
        const http = e as { error?: { error?: string }; message?: string };
        this.error.set(
          http?.error?.error ?? http?.message ?? 'No se pudo subir.'
        );
      }
    });
  }
}
