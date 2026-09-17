import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/** Corrección de licencias y alta de las que no llegan por ninguna fuente. */
@Component({
  selector: 'pt-licencias-config',
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
  templateUrl: './licencias-config.component.html'
})
export class LicenciasConfigComponent extends ConfiguracionBase {}
