import { PortalConfig } from './portal-config.model';

/**
 * Cuentas y conexiones del portal.
 *
 * Vive fuera de los archivos de entorno porque la lista es la misma en
 * desarrollo y en producción: lo único que cambia al desplegar es la raíz del
 * puente. Así no hay dos listas que se desincronicen.
 *
 * Aquí NO van credenciales: este repositorio es público. Usuarios, llaves y
 * tokens viven en el puente, del lado del servidor.
 */
export const PORTAL_DEFAULTS: Pick<PortalConfig, 'accounts' | 'connections'> = {
  accounts: [
    {
      id: 'itech',
      label: 'Itech',
      detail: 'Odoo CRM de Itech',
      kind: 'odoo',
      color: 'violet',
      enabled: true
    },
    {
      id: 'correo-trabajo',
      label: 'Trabajo',
      detail: 'Calendario de la cuenta de trabajo',
      kind: 'google',
      color: 'sky',
      enabled: true
    },
    {
      id: 'correo-personal',
      label: 'Personal',
      detail: 'Calendario de la cuenta personal',
      kind: 'microsoft',
      color: 'emerald',
      enabled: true
    },
    {
      id: 'ops',
      label: 'Ops',
      detail: 'Tablero de pendientes del equipo de desarrollo',
      kind: 'ops',
      color: 'amber',
      enabled: true
    },
    {
      id: 'plataformas',
      label: 'Plataformas',
      detail: 'Sitios y servicios desplegados',
      kind: 'monitor',
      color: 'rose',
      enabled: true
    },
    {
      id: 'claude',
      label: 'Claude',
      detail: 'Consumo de la API y asientos de Claude Code',
      kind: 'anthropic',
      color: 'orange',
      enabled: true
    },
    {
      id: 'cursor',
      label: 'Cursor',
      detail: 'Asientos y solicitudes del equipo',
      kind: 'cursor',
      color: 'indigo',
      enabled: true
    },
    {
      id: 'figma',
      label: 'Figma',
      detail: 'Asientos de edición de la organización',
      kind: 'figma',
      color: 'fuchsia',
      enabled: true
    },
    {
      id: 'vercel',
      label: 'Vercel',
      detail: 'Despliegues y consumo de la plataforma',
      kind: 'vercel',
      color: 'teal',
      enabled: true
    },
    {
      id: 'mios',
      label: 'Míos',
      detail: 'Pendientes que capturo aquí mismo',
      kind: 'local',
      color: 'slate',
      enabled: true
    }
  ],
  connections: [
    {
      id: 'odoo-itech',
      accountId: 'itech',
      kind: 'odoo',
      mode: 'demo',
      provides: ['crm', 'tasks'],
      path: '/odoo/itech'
    },
    {
      id: 'google-trabajo',
      accountId: 'correo-trabajo',
      kind: 'google',
      mode: 'demo',
      provides: ['meetings'],
      path: '/calendar/google/trabajo'
    },
    {
      id: 'microsoft-personal',
      accountId: 'correo-personal',
      kind: 'microsoft',
      mode: 'demo',
      provides: ['meetings'],
      path: '/calendar/microsoft/personal'
    },
    {
      id: 'ops-equipo',
      accountId: 'ops',
      kind: 'ops',
      mode: 'demo',
      provides: ['tasks'],
      path: '/ops/pendientes'
    },
    {
      id: 'monitoreo-plataformas',
      accountId: 'plataformas',
      kind: 'monitor',
      mode: 'demo',
      provides: ['monitors'],
      path: '/monitoreo/estado'
    },
    {
      id: 'claude-consumo',
      accountId: 'claude',
      kind: 'anthropic',
      mode: 'demo',
      provides: ['licenses'],
      path: '/licencias/anthropic'
    },
    {
      id: 'cursor-consumo',
      accountId: 'cursor',
      kind: 'cursor',
      mode: 'demo',
      provides: ['licenses'],
      path: '/licencias/cursor'
    },
    {
      id: 'figma-consumo',
      accountId: 'figma',
      kind: 'figma',
      mode: 'demo',
      provides: ['licenses'],
      path: '/licencias/figma'
    },
    {
      id: 'vercel-despliegues',
      accountId: 'vercel',
      kind: 'vercel',
      mode: 'demo',
      provides: ['deployments', 'licenses'],
      path: '/vercel'
    },
    {
      id: 'pendientes-locales',
      accountId: 'mios',
      kind: 'local',
      mode: 'local',
      provides: ['tasks']
    }
  ]
};
