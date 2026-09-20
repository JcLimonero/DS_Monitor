import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input
} from '@angular/core';
import { PortalStore } from '../core/state/portal.store';
import { ACCOUNT_CHIP_CLASS } from './account-colors';

/**
 * Etiqueta con el nombre de la cuenta de la que viene un dato. Con `sufijo`
 * junta cuenta y origen en un solo chip ("Itech · correo").
 */
@Component({
  selector: 'pt-account-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="chip" [class]="classes()"
      >{{ label() }}
      @if (sufijo(); as s) {
        <span class="font-normal opacity-80">· {{ s }}</span>
      }
    </span>
  `
})
export class AccountChipComponent {
  private readonly store = inject(PortalStore);

  readonly accountId = input.required<string>();
  /** Texto corto que acompaña a la cuenta, por ejemplo el origen. */
  readonly sufijo = input<string>();

  private readonly account = computed(() =>
    this.store.accountOf(this.accountId())
  );

  readonly label = computed(() => this.account()?.label ?? this.accountId());
  readonly classes = computed(
    () => ACCOUNT_CHIP_CLASS[this.account()?.color ?? 'slate']
  );
}
