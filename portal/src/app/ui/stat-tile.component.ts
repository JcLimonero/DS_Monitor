import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, IconName } from './icon.component';

export type StatTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

const TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-ink',
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info'
};

/** Número grande con su etiqueta. Es la unidad de lectura rapida del panel. */
@Component({
  selector: 'pt-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
  template: `
    <a
      class="card card-pad flex items-start gap-3 transition hover:border-brand/40 hover:shadow-md"
      [routerLink]="link()">
      <span class="rounded-lg bg-surface-muted p-2" [class]="toneClass()">
        <pt-icon [name]="icon()" />
      </span>
      <span class="min-w-0">
        <span
          class="block text-2xl font-semibold leading-tight"
          [class]="toneClass()">
          {{ value() }}
        </span>
        <span class="block text-sm font-medium text-ink">{{ label() }}</span>
        @if (hint()) {
          <span class="mt-0.5 block truncate text-xs text-ink-muted">{{
            hint()
          }}</span>
        }
      </span>
    </a>
  `
})
export class StatTileComponent {
  readonly value = input.required<string | number>();
  readonly label = input.required<string>();
  readonly icon = input.required<IconName>();
  readonly link = input.required<string>();
  readonly hint = input<string>();
  readonly tone = input<StatTone>('neutral');

  toneClass(): string {
    return TONE_CLASS[this.tone()];
  }
}
