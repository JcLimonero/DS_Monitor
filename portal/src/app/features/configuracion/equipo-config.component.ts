import { SemanaConfigComponent } from '../ia/semana-config.component';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';
import { EmisoresConfigComponent } from './emisores-config.component';

/** El equipo, quién puede entrar, y los emisores que alimentan la API. */
@Component({
  selector: 'pt-equipo-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SemanaConfigComponent,
    AccountChipComponent,
    DayPipe,
    DecimalPipe,
    EmisoresConfigComponent,
    FormsModule,
    IconComponent,
    NgTemplateOutlet,
    RelativePipe
  ],
  templateUrl: './equipo-config.component.html'
})
export class EquipoConfigComponent extends ConfiguracionBase {}
