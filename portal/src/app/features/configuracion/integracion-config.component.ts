import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountChipComponent } from '../../ui/account-chip.component';
import { IconComponent } from '../../ui/icon.component';
import { DayPipe, RelativePipe } from '../../ui/portal.pipes';
import { ConfiguracionBase } from './configuracion-base';

/**
 * La configuración de una o varias integraciones dentro de su propio módulo:
 * GitHub en Repositorios, Odoo en CRM, monitoreo en Monitoreo, Vercel en
 * Despliegues, Claude/Cursor/Figma en Licencias.
 */
@Component({
  selector: 'pt-integracion-config',
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
  templateUrl: './integracion-config.component.html'
})
export class IntegracionConfigComponent extends ConfiguracionBase {
  /** Qué `kind` de conexiones muestra este panel. */
  readonly kinds = input.required<string[]>();

  readonly filas = computed(() =>
    this.otherRows().filter((row) =>
      this.kinds().includes(row.connection.kind as string)
    )
  );

  /** Integraciones sueltas (sin conexión) que pertenecen a este panel. */
  readonly sueltas = computed(() =>
    this.integracionesSueltas().filter((i) => this.kinds().includes(i.kind))
  );
}
