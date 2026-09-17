import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/** Solo en desarrollo: raíz del backend y token de administración. */
@Component({
  selector: 'pt-avanzado',
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
  templateUrl: './avanzado.component.html'
})
export class AvanzadoComponent extends ConfiguracionBase {}
