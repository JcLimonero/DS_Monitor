import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/** Corrección de licencias y alta de las que no llegan por ninguna fuente. */
@Component({
  selector: 'pt-licencias-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AccountChipComponent,
    DayPipe,
    DecimalPipe,
    DialogoComponent,
    FormsModule,
    IconComponent
  ],
  templateUrl: './licencias-config.component.html'
})
export class LicenciasConfigComponent extends ConfiguracionBase {
  readonly altaLicencia = signal(false);

  abrirAltaLicencia(): void {
    this.altaLicencia.set(true);
  }

  cerrarAltaLicencia(): void {
    this.altaLicencia.set(false);
  }

  confirmarAltaLicencia(): void {
    if (!this.canAddLicense()) {
      return;
    }
    this.addLicense();
    this.altaLicencia.set(false);
  }
}
