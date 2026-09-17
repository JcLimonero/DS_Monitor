import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/** Los buzones y su conexión (IMAP o Microsoft), con la aplicación de Entra ID. */
@Component({
  selector: 'pt-correo-config',
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
  templateUrl: './correo-config.component.html'
})
export class CorreoConfigComponent extends ConfiguracionBase {}
