import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChildren
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CorreoConfigComponent } from '../configuracion/correo-config.component';
import { DominiosConfigComponent } from '../configuracion/dominios-config.component';
import { EmpresasConfigComponent } from '../configuracion/empresas-config.component';
import { EquipoConfigComponent } from '../configuracion/equipo-config.component';
import { AvisosConfigComponent } from '../ia/avisos-config.component';
import { IaUsosComponent } from '../ia/ia-usos.component';
import { IaBitacoraComponent } from '../ia/ia-bitacora.component';
import { EmisoresConfigComponent } from '../configuracion/emisores-config.component';
import { IntegracionConfigComponent } from '../configuracion/integracion-config.component';
import { LicenciasConfigComponent } from '../configuracion/licencias-config.component';
import { RespaldoComponent } from '../configuracion/respaldo.component';
import { ServidoresConfigComponent } from '../configuracion/servidores-config.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

type Pestana =
  | 'equipo'
  | 'empresas'
  | 'avisos'
  | 'dominios'
  | 'correo'
  | 'ia'
  | 'acceso'
  | 'servicios'
  | 'sitios'
  | 'servidores'
  | 'licencias'
  | 'ingesta';

const PESTANAS: { id: Pestana; titulo: string; detalle: string }[] = [
  {
    id: 'equipo',
    titulo: 'Equipo',
    detalle: 'Personas, pedir estatus y correo del lunes'
  },
  {
    id: 'empresas',
    titulo: 'Empresas',
    detalle: 'Las empresas del grupo: nombre, descripción para la IA y buzones'
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
    titulo: 'Acceso y respaldo',
    detalle: 'Código por correo, clave maestra y copia de los datos'
  },
  {
    id: 'servicios',
    titulo: 'Servicios',
    detalle: 'Vercel, GitHub, Odoo y Coolify'
  },
  {
    id: 'sitios',
    titulo: 'Sitios',
    detalle: 'Páginas y APIs que se revisan cada minuto'
  },
  {
    id: 'servidores',
    titulo: 'Servidores',
    detalle: 'Cada VPS con su Prometheus'
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
    IaUsosComponent,
    IaBitacoraComponent,
    CorreoConfigComponent,
    DominiosConfigComponent,
    EmpresasConfigComponent,
    EquipoConfigComponent,
    EmisoresConfigComponent,
    IntegracionConfigComponent,
    LicenciasConfigComponent,
    RespaldoComponent,
    ServidoresConfigComponent,
    FormsModule,
    PageHeaderComponent
  ],
  templateUrl: './integraciones.component.html'
})
export class IntegracionesComponent {
  private readonly router = inject(Router);
  /** Los botones de la franja, para traer el activo a la vista. */
  private readonly botones = viewChildren<ElementRef<HTMLButtonElement>>('tab');
  readonly pestanas = PESTANAS;
  readonly activa = signal<Pestana>(
    (inject(ActivatedRoute).snapshot.queryParamMap.get('tab') as Pestana) ??
      'correo'
  );

  /** Lo que dice la pestaña activa, como subtítulo de la página. */
  readonly detalle = computed(
    () => PESTANAS.find((p) => p.id === this.activa())?.detalle ?? ''
  );

  constructor() {
    afterNextRender(() => this.mostrarActiva());
  }

  elegir(id: Pestana): void {
    this.activa.set(id);
    void this.router.navigate([], {
      queryParams: { tab: id },
      replaceUrl: true
    });
    this.mostrarActiva();
  }

  /** Con doce pestañas, en angosto la activa puede quedar fuera de la franja. */
  private mostrarActiva(): void {
    const id = this.activa();
    const boton = this.botones().find(
      (b) => b.nativeElement.dataset['tab'] === id
    );
    boton?.nativeElement.scrollIntoView({
      inline: 'center',
      block: 'nearest'
    });
  }
}
