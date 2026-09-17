import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DominiosConfigComponent } from '../configuracion/dominios-config.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { IaAlertasComponent } from '../ia/ia-alertas.component';

/**
 * Los dominios registrados: cuándo vencen y cuánto cuesta renovarlos. Salen
 * también en Licencias (como renovación anual) y en Monitoreo (su sitio).
 */
@Component({
  selector: 'pt-dominios',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DominiosConfigComponent, IaAlertasComponent, PageHeaderComponent],
  template: `
    <pt-page-header
      title="Dominios"
      subtitle="Registro, vencimiento y costo de renovación de cada dominio" />
    <div class="mb-4">
      <pt-ia-alertas titulo="Dominios que requieren atención" [tipos]="['dominio']" />
    </div>
    <pt-dominios-config />
  `
})
export class DominiosComponent {}
