import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/** Los dominios registrados: vencimiento y costo. */
@Component({
  selector: 'pt-dominios-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    DayPipe,
    DecimalPipe,
    FormsModule,
    IconComponent,
    NgTemplateOutlet,
    RelativePipe
  ],
  templateUrl: './dominios-config.component.html'
})
export class DominiosConfigComponent extends ConfiguracionBase {}
