import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CorreoConfigComponent } from '../configuracion/correo-config.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

/**
 * Los buzones de correo: de ahí salen juntas, pendientes y licencias. Aquí se
 * agregan, se conectan (IMAP o Microsoft) y se ve cómo va cada uno.
 */
@Component({
  selector: 'pt-correo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CorreoConfigComponent, PageHeaderComponent],
  template: `
    <pt-page-header
      title="Correo"
      subtitle="Buzones conectados: de cada uno salen juntas, pendientes y licencias" />
    <pt-correo-config />
  `
})
export class CorreoComponent {}
