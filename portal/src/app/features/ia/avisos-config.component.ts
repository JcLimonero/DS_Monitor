import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input
} from '@angular/core';
import { PushService } from '../../core/push/push.service';
import { IconComponent } from '../../ui/icon.component';

/** Activar o apagar los avisos push en este dispositivo. */
@Component({
  selector: 'pt-avisos-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <section class="card card-pad" [class.mt-4]="conMargen()">
      <h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
        <pt-icon name="alerta" class="h-4 w-4 text-brand" />
        Avisos en este dispositivo
      </h2>
      <p class="mt-0.5 text-xs text-ink-muted">
        Te avisa cuando te asignan un pendiente, cuando algo vence hoy y cuando
        un sitio se cae. Se activa por dispositivo.
        @if (push.necesitaInstalar) {
          En iPhone primero agrega DS Monitor a la pantalla de inicio (Compartir
          → Agregar a inicio) y actívalo desde ahí.
        }
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        @switch (push.estado()) {
          @case ('no_soportado') {
            <span class="text-sm text-ink-muted"
              >Este navegador no admite avisos.</span
            >
          }
          @case ('bloqueado') {
            <span class="text-sm text-danger">
              Los avisos están bloqueados en el navegador; permítelos en los
              ajustes del sitio.
            </span>
          }
          @case ('activo') {
            <span class="chip bg-emerald-100 text-emerald-800">Activos</span>
            <button type="button" class="btn" (click)="push.probar()">
              Mandar prueba
            </button>
            <button type="button" class="btn" (click)="push.desactivar()">
              Apagar
            </button>
          }
          @case ('ocupado') {
            <span class="text-sm text-ink-muted">Activando…</span>
          }
          @default {
            <button
              type="button"
              class="btn btn-primary"
              (click)="push.activar()">
              Activar avisos
            </button>
          }
        }
      </div>
      @if (push.mensaje(); as m) {
        <p class="mt-2 text-xs text-ink-muted">{{ m }}</p>
      }
    </section>
  `
})
export class AvisosConfigComponent {
  readonly push = inject(PushService);
  readonly conMargen = input(true);

  constructor() {
    void this.push.revisar();
  }
}
