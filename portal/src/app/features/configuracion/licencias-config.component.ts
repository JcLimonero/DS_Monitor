import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { LicenciasService } from '../../core/licencias/licencias.service';
import { FormsModule } from '@angular/forms';
import { LicenseUsage } from '../../core/models';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { LicenciaAltaDialogoComponent } from '../../ui/licencia-alta.component';
import { LicenciaRenovacionDialogoComponent } from '../../ui/licencia-renovacion.component';
import { LicenciasMigracionComponent } from '../../ui/licencias-migracion.component';
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
    IconComponent,
    LicenciaAltaDialogoComponent,
    LicenciaRenovacionDialogoComponent,
    LicenciasMigracionComponent
  ],
  templateUrl: './licencias-config.component.html'
})
export class LicenciasConfigComponent extends ConfiguracionBase {
  readonly altaLicencia = signal(false);
  /** La licencia que se está confirmando como renovada. */
  readonly renovando = signal<LicenseUsage | undefined>(undefined);
  /** La licencia a mano que se está por quitar ("¿Quitar? Sí / No"). */
  readonly quitando = signal<string | undefined>(undefined);
  readonly soloEnNavegador = inject(LicenciasService).soloEnEsteNavegador;

  quitarConfirmado(id: string): void {
    this.quitando.set(undefined);
    this.removeManualLicense(id);
  }

  abrirAltaLicencia(): void {
    this.altaLicencia.set(true);
  }

  cerrarAltaLicencia(): void {
    this.altaLicencia.set(false);
  }

  abrirRenovacion(licencia: LicenseUsage): void {
    this.renovando.set(licencia);
  }

  cerrarRenovacion(): void {
    this.renovando.set(undefined);
  }
}
