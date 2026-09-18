import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import { PuenteAdminService } from '../../core/sources/gateway/puente-admin.service';
import { describirError } from '../../core/ia/ia.service';

interface Uso {
  id: string;
  titulo: string;
  detalle: string;
}

/**
 * Dónde se permite usar la llave de OpenRouter. Cada interruptor prende o
 * apaga un uso; lo apagado no gasta: el puente ni llama al modelo.
 */
@Component({
  selector: 'pt-ia-usos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-pad mt-4">
      <h2 class="text-sm font-semibold text-ink">Dónde se usa la IA</h2>
      <p class="mt-0.5 text-xs text-ink-muted">
        Cada uso se prende o apaga aquí; lo apagado no gasta ni un token. Los
        cambios aplican al momento.
      </p>
      <ul class="mt-3 divide-y divide-line">
        @for (u of catalogo(); track u.id) {
          <li class="flex items-start gap-3 py-2">
            <label
              class="mt-0.5 inline-flex shrink-0 cursor-pointer items-center">
              <input
                type="checkbox"
                class="peer sr-only"
                [checked]="usos()[u.id]"
                [disabled]="ocupado()"
                (change)="alternar(u.id)" />
              <span
                class="h-6 w-10 rounded-full bg-slate-300 transition peer-checked:bg-brand dark:bg-slate-600"></span>
              <span
                class="absolute ml-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-4"></span>
            </label>
            <span class="min-w-0">
              <span class="block text-sm font-medium text-ink">{{
                u.titulo
              }}</span>
              <span class="block text-xs text-ink-muted">{{ u.detalle }}</span>
            </span>
          </li>
        }
      </ul>
      @if (mensaje(); as m) {
        <p class="mt-2 text-xs text-ink-muted">{{ m }}</p>
      }
    </section>
  `
})
export class IaUsosComponent {
  private readonly http = inject(HttpClient);
  private readonly config = inject(PORTAL_CONFIG);
  private readonly admin = inject(PuenteAdminService);

  readonly usos = signal<Record<string, boolean>>({});
  readonly catalogo = signal<Uso[]>([]);
  readonly ocupado = signal(false);
  readonly mensaje = signal<string | undefined>(undefined);

  constructor() {
    if (this.config.gatewayUrl) {
      this.http
        .get<{ usos: Record<string, boolean>; catalogo: Uso[] }>(
          `${this.config.gatewayUrl}/ia/usos`
        )
        .subscribe({
          next: (r) => {
            this.usos.set(r.usos);
            this.catalogo.set(r.catalogo);
          },
          error: (e: unknown) => this.mensaje.set(describirError(e))
        });
    }
  }

  alternar(id: string): void {
    const nuevo = { ...this.usos(), [id]: !this.usos()[id] };
    this.usos.set(nuevo);
    this.ocupado.set(true);
    const token = this.admin.token();
    this.http
      .post<{ usos: Record<string, boolean> }>(
        `${this.config.gatewayUrl}/ia/usos`,
        nuevo,
        { headers: token ? { authorization: `Bearer ${token}` } : {} }
      )
      .subscribe({
        next: (r) => {
          this.usos.set(r.usos);
          this.ocupado.set(false);
          this.mensaje.set(undefined);
        },
        error: (e: unknown) => {
          this.ocupado.set(false);
          this.mensaje.set(describirError(e));
        }
      });
  }
}
