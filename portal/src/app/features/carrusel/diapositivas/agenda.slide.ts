import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject
} from '@angular/core';
import { Meeting } from '../../../core/models';
import {
  meetingConflicts,
  meetingsOn
} from '../../../core/state/portal.selectors';
import { PortalStore } from '../../../core/state/portal.store';
import { addDays } from '../../../core/util/date.util';
import { ACCOUNT_BAR_CLASS } from '../../../ui/account-colors';
import { IconComponent } from '../../../ui/icon.component';
import { TimePipe } from '../../../ui/portal.pipes';

/** Cuantas juntas caben por columna sin apretar la pantalla. */
const RENGLONES = 6;

/** Hoy y mañana, lado a lado, con las cuentas distinguidas por color. */
@Component({
  selector: 'pt-slide-agenda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TimePipe],
  host: { class: 'grid h-full grid-cols-1 gap-6 lg:grid-cols-2' },
  template: `
    @for (columna of columnas(); track columna.titulo) {
      <section class="flex min-h-0 flex-col">
        <h2 class="shrink-0 tv-label">{{ columna.titulo }}</h2>

        @if (columna.juntas.length > 0) {
          <ul
            class="mt-3 flex min-h-0 flex-1 flex-col justify-center gap-2.5 overflow-hidden">
            @for (junta of columna.juntas; track junta.id) {
              <li
                class="tv-card relative flex shrink-0 items-center gap-4 overflow-hidden py-5 pl-6 pr-5">
                <span class="account-bar" [class]="colorCuenta(junta)"></span>
                <span
                  class="shrink-0 text-2xl font-bold tabular-nums text-ink 2xl:text-3xl">
                  {{ junta.start | hora }}
                </span>
                <span class="min-w-0 flex-1">
                  <span
                    class="block truncate text-xl font-bold text-ink 2xl:text-2xl"
                    [class.line-through]="junta.status === 'cancelada'">
                    {{ junta.title }}
                  </span>
                  <span
                    class="block truncate text-base text-ink-muted 2xl:text-lg">
                    {{ nombreCuenta(junta) }}
                    @if (junta.location) {
                      · {{ junta.location }}
                    }
                  </span>
                </span>
                @if (empalmadas().has(junta.id)) {
                  <pt-icon name="alerta" class="h-7 w-7 shrink-0 text-warn" />
                }
              </li>
            }
          </ul>

          @if (columna.restantes > 0) {
            <p class="mt-2 shrink-0 text-center text-lg text-ink-muted">
              y {{ columna.restantes }} más
            </p>
          }
        } @else {
          <div
            class="mt-3 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-line">
            <p class="text-2xl text-ink-subtle">Sin juntas</p>
          </div>
        }
      </section>
    }
  `
})
export class AgendaSlideComponent {
  private readonly store = inject(PortalStore);

  private readonly hoy = computed(() =>
    meetingsOn(this.store.meetings(), new Date())
  );
  private readonly manana = computed(() =>
    meetingsOn(this.store.meetings(), addDays(new Date(), 1))
  );

  readonly columnas = computed(() => [
    {
      titulo: 'Hoy',
      juntas: this.hoy().slice(0, RENGLONES),
      restantes: Math.max(0, this.hoy().length - RENGLONES)
    },
    {
      titulo: 'Mañana',
      juntas: this.manana().slice(0, RENGLONES),
      restantes: Math.max(0, this.manana().length - RENGLONES)
    }
  ]);

  /** Juntas que chocan con otra, para marcarlas con el triángulo. */
  readonly empalmadas = computed(() => {
    const ids = new Set<string>();
    for (const dia of [this.hoy(), this.manana()]) {
      for (const [a, b] of meetingConflicts(dia)) {
        ids.add(a.id);
        ids.add(b.id);
      }
    }
    return ids;
  });

  colorCuenta(junta: Meeting): string {
    return ACCOUNT_BAR_CLASS[
      this.store.accountOf(junta.accountId)?.color ?? 'slate'
    ];
  }

  nombreCuenta(junta: Meeting): string {
    return this.store.accountOf(junta.accountId)?.label ?? junta.accountId;
  }
}
