import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MEETING_STATUS_LABEL, Meeting } from '../../core/models';
import { meetingConflicts } from '../../core/state/portal.selectors';
import { PortalStore } from '../../core/state/portal.store';
import {
  addDays,
  formatLongDay,
  isSameDay,
  startOfDay
} from '../../core/util/date.util';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { TimePipe } from '../../ui/portal.pipes';

interface DayGroup {
  key: string;
  label: string;
  isToday: boolean;
  meetings: Meeting[];
}

/** Cuántos días hacia adelante muestra cada rango del selector. */
const RANGES = [
  { id: 'hoy', label: 'Hoy', days: 1 },
  { id: 'semana', label: '7 días', days: 7 },
  { id: 'quincena', label: '14 días', days: 14 }
] as const;

type RangeId = (typeof RANGES)[number]['id'];

@Component({
  selector: 'pt-agenda',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    TimePipe
  ],
  templateUrl: './agenda.component.html'
})
export class AgendaComponent {
  private readonly store = inject(PortalStore);

  readonly ranges = RANGES;
  readonly statusLabel = MEETING_STATUS_LABEL;

  readonly range = signal<RangeId>('semana');
  readonly accountId = signal<'todas' | string>('todas');
  readonly hideCancelled = signal(true);

  /** Cuentas que de verdad traen juntas, no todas las configuradas. */
  readonly calendarAccounts = computed(() => {
    const ids = new Set(
      this.store.meetings().map((meeting) => meeting.accountId)
    );
    return this.store.accounts.filter((account) => ids.has(account.id));
  });

  private readonly visible = computed<Meeting[]>(() => {
    const days = RANGES.find((option) => option.id === this.range())?.days ?? 7;
    const from = startOfDay(new Date()).getTime();
    const to = addDays(startOfDay(new Date()), days).getTime();
    const accountId = this.accountId();

    return this.store
      .meetings()
      .filter((meeting) => {
        const start = new Date(meeting.start).getTime();
        return start >= from && start < to;
      })
      .filter(
        (meeting) => accountId === 'todas' || meeting.accountId === accountId
      )
      .filter(
        (meeting) => !this.hideCancelled() || meeting.status !== 'cancelada'
      )
      .sort((a, b) => a.start.localeCompare(b.start));
  });

  readonly days = computed<DayGroup[]>(() => {
    const today = new Date();
    const groups = new Map<string, DayGroup>();
    for (const meeting of this.visible()) {
      const start = new Date(meeting.start);
      const key = startOfDay(start).toISOString();
      const group = groups.get(key) ?? {
        key,
        label: formatLongDay(start),
        isToday: isSameDay(start, today),
        meetings: []
      };
      group.meetings.push(meeting);
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  /** Identificadores de las juntas que chocan con otra, para resaltarlas. */
  private readonly conflictIds = computed(() => {
    const ids = new Set<string>();
    for (const [a, b] of meetingConflicts(this.visible())) {
      ids.add(a.id);
      ids.add(b.id);
    }
    return ids;
  });

  readonly conflictCount = computed(() => this.conflictIds().size);
  readonly total = computed(() => this.visible().length);

  readonly subtitle = computed(() => {
    const total = this.total();
    const juntas = total === 1 ? '1 junta' : `${total} juntas`;
    return `${juntas} en el rango · ${this.conflictCount()} con empalme`;
  });

  hasConflict(meeting: Meeting): boolean {
    return this.conflictIds().has(meeting.id);
  }

  durationOf(meeting: Meeting): string {
    const minutes = Math.round(
      (new Date(meeting.end).getTime() - new Date(meeting.start).getTime()) /
        60_000
    );
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
}
