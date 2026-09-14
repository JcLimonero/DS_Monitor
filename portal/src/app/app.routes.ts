import { Routes } from '@angular/router';

/**
 * Las vistas se cargan por separado para que el arranque solo traiga el panel.
 */
export const routes: Routes = [
  {
    path: 'panel',
    title: 'Panel | Portal',
    loadComponent: () =>
      import('./features/panel/panel.component').then((m) => m.PanelComponent)
  },
  {
    path: 'pendientes',
    title: 'Pendientes | Portal',
    loadComponent: () =>
      import('./features/pendientes/pendientes.component').then(
        (m) => m.PendientesComponent
      )
  },
  {
    path: 'agenda',
    title: 'Agenda | Portal',
    loadComponent: () =>
      import('./features/agenda/agenda.component').then(
        (m) => m.AgendaComponent
      )
  },
  {
    path: 'monitoreo',
    title: 'Monitoreo | Portal',
    loadComponent: () =>
      import('./features/monitoreo/monitoreo.component').then(
        (m) => m.MonitoreoComponent
      )
  },
  {
    path: 'crm',
    title: 'CRM Odoo | Portal',
    loadComponent: () =>
      import('./features/crm/crm.component').then((m) => m.CrmComponent)
  },
  {
    path: 'equipo',
    title: 'Equipo | Portal',
    loadComponent: () =>
      import('./features/equipo/equipo.component').then(
        (m) => m.EquipoComponent
      )
  },
  {
    path: 'ajustes',
    title: 'Ajustes | Portal',
    loadComponent: () =>
      import('./features/ajustes/ajustes.component').then(
        (m) => m.AjustesComponent
      )
  },
  { path: '', pathMatch: 'full', redirectTo: 'panel' },
  { path: '**', redirectTo: 'panel' }
];
