import { accountsOf } from '../../../core/util/meetings.util';
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
import { CALENDAR_SOURCES } from '../../../core/sources/source.contracts';
import { addDays } from '../../../core/util/date.util';
import { ACCOUNT_BAR_CLASS } from '../../../ui/account-colors';
import { IconComponent } from '../../../ui/icon.component';
import { TimePipe } from '../../../ui/portal.pipes';
import { DiapositivaConContenido } from '../carrusel.model';

/** Hoy y mañana, lado a lado, con las cuentas distinguidas por color. */
@Component({
  selector: 'pt-slide-agenda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, TimePipe],
  host: { class: 'grid h-full grid-cols-2 gap-3 max-sm:grid-cols-1' },
  template: `
    @for (columna of columnas(); track columna.titulo) {
      <section class="flex min-h-0 min-w-0 flex-col">
        <h2 class="tv-label shrink-0">{{ columna.titulo }}</h2>

        @if (columna.juntas.length > 0) {
          <!--
            Todas las juntas, con scroll si no caben. En pantallas bajas el
            titulo se recorta a una linea (menos de 700 px de alto) para que quepan
            diez juntas.
          -->
          <ul
            class="mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
            @for (junta of columna.juntas; track junta.id) {
              <li
                class="tv-card relative flex shrink-0 items-center gap-3 overflow-hidden py-1 pl-4 pr-3">
                <span class="account-bar" [class]="colorCuenta(junta)"></span>
                <span
                  class="shrink-0 text-xl font-bold tabular-nums leading-none text-ink">
                  {{ junta.start | hora }}
                </span>
                <span class="min-w-0 flex-1">
                  <span
                    class="tv-nombre line-clamp-2 [@media(max-height:699px)]:line-clamp-1"
                    [class.line-through]="junta.status === 'cancelada'">
                    {{ junta.title }}
                  </span>
                  <span class="tv-dato line-clamp-1">
                    {{ nombreCuenta(junta) }}
                    @if (junta.location) {
                      · {{ junta.location }}
                    }
                  </span>
                </span>
                @if (empalmadas().has(junta.id)) {
                  <pt-icon name="alerta" class="h-5 w-5 shrink-0 text-warn" />
                }
              </li>
            }
          </ul>
        } @else {
          <div
            class="mt-1.5 flex flex-1 items-center justify-center rounded-xl border border-dashed border-line">
            <p class="tv-title !font-normal text-ink-subtle">Sin juntas</p>
          </div>
        }
      </section>
    }
  `
})
export class AgendaSlideComponent implements DiapositivaConContenido {
  private readonly store = inject(PortalStore);
  /** Google, Microsoft e IMAP: cada buzón trae su calendario. */
  private readonly calendarios = inject(CALENDAR_SOURCES);

  private readonly hoy = computed(() =>
    meetingsOn(this.store.meetings(), new Date())
  );
  private readonly manana = computed(() =>
    meetingsOn(this.store.meetings(), addDays(new Date(), 1))
  );

  /**
   * Ni hoy ni mañana hay juntas. Mientras algún calendario no conteste,
   * el array sigue en [] y no cuenta como vacía.
   */
  readonly vacia = computed(() => {
    for (const kind of new Set(this.calendarios.map((fuente) => fuente.kind))) {
      if (!this.store.fuenteContestada(kind)) {
        return false;
      }
    }
    return this.hoy().length === 0 && this.manana().length === 0;
  });

  readonly columnas = computed(() => [
    {
      titulo: 'Hoy',
      juntas: this.hoy()
    },
    {
      titulo: 'Mañana',
      juntas: this.manana()
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
    return accountsOf(junta)
      .map((id) => this.store.accountOf(id)?.label ?? id)
      .join(' · ');
  }
}
