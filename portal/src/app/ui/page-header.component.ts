import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'pt-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {{ title() }}
        </h1>
        @if (subtitle()) {
          <p class="mt-1 text-sm text-ink-muted">{{ subtitle() }}</p>
        }
      </div>
      <ng-content />
    </header>
  `
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
}
