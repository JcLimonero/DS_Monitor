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
        path: 'ajustes',
        title: 'Ajustes | DS Monitor',
        loadComponent: () =>
          import('./features/ajustes/ajustes.component').then(
            (m) => m.AjustesComponent
          )
      },
      { path: '', pathMatch: 'full', redirectTo: 'panel' }
    ]
  },
  { path: '**', redirectTo: 'panel' }
];
