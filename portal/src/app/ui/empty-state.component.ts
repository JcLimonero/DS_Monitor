import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent, IconName } from './icon.component';

@Component({
  selector: 'pt-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <div class="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <pt-icon [name]="icon()" class="h-8 w-8 text-ink-subtle" />
      <p class="text-sm font-medium text-ink">{{ title() }}</p>
      @if (hint()) {
        <p class="max-w-sm text-sm text-ink-muted">{{ hint() }}</p>
      }
    </div>
  `
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly hint = input<string>();
  readonly icon = input<IconName>('bandeja');
}
