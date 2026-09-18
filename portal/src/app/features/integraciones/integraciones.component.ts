import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CorreoConfigComponent } from '../configuracion/correo-config.component';
import { DominiosConfigComponent } from '../configuracion/dominios-config.component';
import { EquipoConfigComponent } from '../configuracion/equipo-config.component';
import { AvisosConfigComponent } from '../ia/avisos-config.component';
import { EmisoresConfigComponent } from '../configuracion/emisores-config.component';
import { IntegracionConfigComponent } from '../configuracion/integracion-config.component';
import { LicenciasConfigComponent } from '../configuracion/licencias-config.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

type Pestana =
  | 'equipo'
  | 'avisos'
  | 'dominios'
  | 'correo'
  | 'ia'
  | 'acceso'
  | 'servicios'
  | 'licencias'
  | 'ingesta';

const PESTANAS: { id: Pestana; titulo: string; detalle: string }[] = [
  {
    id: 'equipo',
    titulo: 'Equipo',
    detalle: 'Personas, pedir estatus y correo del lunes'
  },
  {
    id: 'avisos',
    titulo: 'Avisos',
    detalle: 'Notificaciones en este dispositivo'
  },
  {
    id: 'dominios',
    titulo: 'Dominios',
    detalle: 'Registro, vencimiento y costo de cada dominio'
  },
  {
    id: 'correo',
    titulo: 'Correo',
    detalle: 'Buzones, Microsoft (Entra ID) y Google'
  },
  {
    id: 'ia',
    titulo: 'IA y chat',
    detalle: 'OpenRouter, Fireflies y Telegram'
  },
  {
    id: 'acceso',
    titulo: 'Acceso',
    detalle: 'Código por correo y clave maestra'
  },
  {
    id: 'servicios',
    titulo: 'Servicios',
    detalle: 'Vercel, GitHub, Odoo y monitoreo de sitios'
  },
  {
    id: 'licencias',
    titulo: 'Licencias',
    detalle: 'Claude, Cursor, Figma y licencias a mano'
  },
  {
    id: 'ingesta',
    titulo: 'API de ingesta',
    detalle: 'Quién puede mandar datos al puente'
  }
];

/**
 * Todo lo que se conecta, en un solo lugar y por pestañas. Cada módulo
 * (Agenda, Repos, CRM…) ya no carga su propia configuración: se viene aquí.
 */
@Component({
  selector: 'pt-integraciones',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AvisosConfigComponent,
    CorreoConfigComponent,
    DominiosConfigComponent,
    EquipoConfigComponent,
    EmisoresConfigComponent,
    IntegracionConfigComponent,
    LicenciasConfigComponent,
    PageHeaderComponent
  ],
  templateUrl: './integraciones.component.html'
})
export class IntegracionesComponent {
  private readonly router = inject(Router);
  readonly pestanas = PESTANAS;
  readonly activa = signal<Pestana>(
    (inject(ActivatedRoute).snapshot.queryParamMap.get('tab') as Pestana) ??
      'correo'
  );

  elegir(id: Pestana): void {
    this.activa.set(id);
    void this.router.navigate([], {
      queryParams: { tab: id },
      replaceUrl: true
    });
  }
}
