import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/** Los buzones y su conexión (IMAP o Microsoft), con la aplicación de Entra ID. */
@Component({
  selector: 'pt-correo-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DialogoComponent,
    FormsModule,
    IconComponent,
    NgTemplateOutlet,
    RelativePipe
  ],
  templateUrl: './correo-config.component.html'
})
export class CorreoConfigComponent extends ConfiguracionBase {
  readonly altaBuzon = signal(false);

  abrirAltaBuzon(): void {
    this.newMailLabel.set('');
    this.newMailEmail.set('');
    this.altaBuzon.set(true);
  }

  cerrarAltaBuzon(): void {
    this.altaBuzon.set(false);
  }

  confirmarAltaBuzon(): void {
    if (!this.canAddMail()) {
      return;
    }
    this.addMail();
    this.altaBuzon.set(false);
  }
}
