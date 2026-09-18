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
      enabled: false
    },
    // --- Buzones de correo ---
    //
    // De cada uno se sacan tres cosas: las juntas (invitaciones con archivo
    // de calendario), los pendientes (correos que piden una acción: un pago
    // rechazado, un dominio por vencer) y las licencias (recibos y avisos de
    // renovación de suscripciones). El puente entra con las credenciales de
    // CORREO_CUENTAS; aquí solo va la dirección.
    {
      id: 'correo-nexus',
      label: 'Nexus',
      detail: 'carlos.limon@nexusqtech.com · Microsoft 365',
      kind: 'microsoft',
      color: 'sky',
      enabled: true
    },
    {
      id: 'correo-outlook',
      label: 'Outlook',
      detail: 'carloslimon@outlook.com · Microsoft personal',
      kind: 'microsoft',
      color: 'emerald',
      enabled: true
    },
    {
      id: 'correo-vanguardia',
      label: 'Vanguardia',
      detail: 'webmaster@grupovanguardia.com · Microsoft 365',
      kind: 'microsoft',
      color: 'teal',
      enabled: true
    },
    {
      id: 'correo-itech',
      label: 'Itech correo',
      detail: 'climon@itechdev.com.mx · Microsoft 365',
      kind: 'microsoft',
      color: 'violet',
      enabled: true
    },
    {
      id: 'correo-itech-alterno',
      label: 'Itech alterno',
      detail: 'carlos.limon@itechdev.com.mx · Microsoft 365 (buzón vacío hoy)',
      kind: 'microsoft',
      color: 'violet',
      enabled: false
    },
    {
      id: 'correo-gmail',
      label: 'Gmail',
      detail: 'limon2633@gmail.com · Google',
      kind: 'google',
      color: 'amber',
      enabled: true
    },
    {
      id: 'correo-icloud',
      label: 'iCloud',
      detail: 'limon2633@icloud.com · IMAP en iCloud',
      kind: 'imap',
      color: 'rose',
      enabled: true
    },
    {
      id: 'correo-dealer',
      label: 'Dealer',
      detail: 'carlos.limon@dealersolutions.com.mx · IMAP en Neubox',
      kind: 'imap',
      color: 'fuchsia',
      enabled: true
    },
    {
      id: 'ops',
      label: 'Ops',
      detail: 'Tablero de pendientes del equipo de desarrollo',
      kind: 'ops',
      color: 'amber',
      enabled: false
    },
    {
      id: 'plataformas',
      label: 'Plataformas',
      detail: 'Sitios y servicios desplegados',
      kind: 'monitor',
      color: 'rose',
      enabled: false
    },
    // Las integraciones que necesitan credencial (Odoo, Ops, monitoreo,
    // Vercel, Claude, Cursor, Figma) arrancan apagadas: la aplicación no
    // muestra datos inventados. Se encienden solas al configurarlas en
    // Ajustes → Integraciones.
    {
      id: 'claude',
      label: 'Claude',
      detail: 'Consumo de la API y asientos de Claude Code',
      kind: 'anthropic',
      color: 'orange',
      enabled: false
    },
    {
      id: 'openrouter',
      label: 'OpenRouter',
      detail: 'Consumo de la IA del portal (por llave, en USD)',
      kind: 'openrouter',
      color: 'violet',
      enabled: false
    },
    {
      id: 'cursor',
      label: 'Cursor',
      detail: 'Asientos y solicitudes del equipo',
      kind: 'cursor',
      color: 'indigo',
      enabled: false
    },
    {
      id: 'figma',
      label: 'Figma',
      detail: 'Asientos de edición de la organización',
      kind: 'figma',
      color: 'fuchsia',
      enabled: false
    },
    {
      id: 'vercel',
      label: 'Vercel',
      detail: 'Despliegues y consumo de la plataforma',
      kind: 'vercel',
      color: 'teal',
      enabled: false
    },
    {
      id: 'github',
      label: 'GitHub',
      detail: 'Estado de los repositorios y sus pull requests',
      kind: 'github',
      color: 'slate',
      enabled: true
    },
    {
      id: 'dominios',
      label: 'Dominios',
      detail: 'Dominios registrados: vencimiento y costo de renovación',
      kind: 'dominios',
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
    // Cada buzón es una conexión: así se enciende de uno en uno y Ajustes dice
    // cuál falta. La ruta lleva el identificador de la cuenta.
    {
      id: 'correo-nexus',
      accountId: 'correo-nexus',
      kind: 'microsoft',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-nexus'
    },
    {
      id: 'correo-outlook',
      accountId: 'correo-outlook',
      kind: 'microsoft',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-outlook'
    },
    {
      id: 'correo-vanguardia',
      accountId: 'correo-vanguardia',
      kind: 'microsoft',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-vanguardia'
    },
    {
      id: 'correo-itech',
      accountId: 'correo-itech',
      kind: 'microsoft',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-itech'
    },
    {
      id: 'correo-itech-alterno',
      accountId: 'correo-itech-alterno',
      kind: 'microsoft',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-itech-alterno'
    },
    {
      id: 'correo-gmail',
      accountId: 'correo-gmail',
      kind: 'google',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-gmail'
    },
    {
      id: 'correo-icloud',
      accountId: 'correo-icloud',
      kind: 'imap',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-icloud'
    },
    {
      id: 'correo-dealer',
      accountId: 'correo-dealer',
      kind: 'imap',
      mode: 'gateway',
      provides: ['meetings', 'tasks', 'licenses'],
      path: '/correo/correo-dealer'
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
      id: 'openrouter-consumo',
      accountId: 'openrouter',
      kind: 'openrouter',
      mode: 'gateway',
      provides: ['licenses'],
      path: '/licencias/openrouter'
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
      // Solo despliegues: el consumo de Vercel se cobra por correo y de ahí
      // sale la licencia, no de esta conexión.
      provides: ['deployments'],
      path: '/vercel'
    },
    {
      id: 'github-repos',
      accountId: 'github',
      kind: 'github',
      mode: 'demo',
      provides: ['repos'],
      path: '/github'
    },
    {
      id: 'dominios',
      accountId: 'dominios',
      kind: 'dominios',
      // Viven en el puente (se capturan en Ajustes → Dominios) y salen en el
      // tablero de licencias como renovaciones anuales.
      mode: 'gateway',
      provides: ['licenses'],
      path: '/dominios'
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
