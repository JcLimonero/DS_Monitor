import { Routes } from '@angular/router';

/**
 * Dos ramas: el armazon con barra lateral, y el carrusel del monitor, que corre
 * a pantalla completa sin nada alrededor.
 *
 * Las vistas se cargan por separado para que el arranque solo traiga la que se
 * esta abriendo.
 */
export const routes: Routes = [
  {
    path: 'acceso',
    title: 'Acceso | DS Monitor',
    loadComponent: () =>
      import('./features/acceso/acceso.component').then(
        (m) => m.AccesoComponent
      )
  },
  {
    path: 'carrusel',
    title: 'Carrusel | DS Monitor',
    loadComponent: () =>
      import('./features/carrusel/carrusel.component').then(
        (m) => m.CarruselComponent
      )
  },
  {
    path: '',
    loadComponent: () =>
      import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'panel',
        title: 'Panel | DS Monitor',
        loadComponent: () =>
          import('./features/panel/panel.component').then(
            (m) => m.PanelComponent
          )
      },
      {
        path: 'pendientes',
        title: 'Pendientes | DS Monitor',
        loadComponent: () =>
          import('./features/pendientes/pendientes.component').then(
            (m) => m.PendientesComponent
          )
      },
      {
        path: 'personales',
        title: 'Pendientes personales | DS Monitor',
        loadComponent: () =>
          import('./features/personales/personales.component').then(
            (m) => m.PersonalesComponent
          )
      },
      {
        path: 'hoy',
        title: 'Hoy | DS Monitor',
        loadComponent: () =>
          import('./features/hoy/hoy.component').then((m) => m.HoyComponent)
      },
      {
        path: 'dictado',
        title: 'Dictar | DS Monitor',
        loadComponent: () =>
          import('./features/dictado/dictado.component').then(
            (m) => m.DictadoComponent
          )
      },
      {
        path: 'agenda',
        title: 'Agenda | DS Monitor',
        loadComponent: () =>
          import('./features/agenda/agenda.component').then(
            (m) => m.AgendaComponent
          )
      },
      {
        path: 'monitoreo',
        title: 'Monitoreo | DS Monitor',
        loadComponent: () =>
          import('./features/monitoreo/monitoreo.component').then(
            (m) => m.MonitoreoComponent
          )
      },
      {
        path: 'crm',
        title: 'CRM Odoo | DS Monitor',
        loadComponent: () =>
          import('./features/crm/crm.component').then((m) => m.CrmComponent)
      },
      {
        path: 'repos',
        title: 'Repositorios | DS Monitor',
        loadComponent: () =>
          import('./features/repos/repos.component').then(
            (m) => m.ReposComponent
          )
      },
      {
        path: 'licencias',
        title: 'Licencias | DS Monitor',
        loadComponent: () =>
          import('./features/licencias/licencias.component').then(
            (m) => m.LicenciasComponent
          )
      },
      {
        path: 'despliegues',
        title: 'Despliegues | DS Monitor',
        loadComponent: () =>
          import('./features/despliegues/despliegues.component').then(
            (m) => m.DesplieguesComponent
          )
      },
      {
        path: 'equipo',
        title: 'Equipo | DS Monitor',
        loadComponent: () =>
          import('./features/equipo/equipo.component').then(
            (m) => m.EquipoComponent
          )
      },
      {
        path: 'correo',
        title: 'Correo | DS Monitor',
        loadComponent: () =>
          import('./features/correo/correo.component').then(
            (m) => m.CorreoComponent
          )
      },
      {
        path: 'dominios',
        title: 'Dominios | DS Monitor',
        loadComponent: () =>
          import('./features/dominios/dominios.component').then(
            (m) => m.DominiosComponent
          )
      },
      {
        // Solo en desarrollo: raíz del backend y token. En producción no hay
        // nada que ajustar fuera de cada módulo.
        path: 'avanzado',
        title: 'Avanzado | DS Monitor',
        loadComponent: () =>
          import('./features/configuracion/avanzado.component').then(
            (m) => m.AvanzadoComponent
          )
      },
      { path: 'ajustes', redirectTo: 'correo' },
      { path: '', pathMatch: 'full', redirectTo: 'panel' }
    ]
  },
  { path: '**', redirectTo: 'panel' }
];
