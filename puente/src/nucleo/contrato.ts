/**
 * El contrato entre el puente y el portal.
 *
 * Son los mismos tipos que el portal define en
 * `portal/src/app/core/models/`. Aqui viven copiados a proposito: el puente es
 * un servicio aparte y no debe compilar contra el codigo de una aplicacion
 * Angular.
 *
 * Para que la copia no se desincronice en silencio, `contrato/sincronia.ts`
 * comprueba en tiempo de compilacion que ambos lados sigan siendo asignables
 * entre si. Si alguien cambia un campo de un lado y no del otro,
 * `npm run check:contrato` deja de compilar.
 */

export interface Person {
  id: string;
  name: string;
  email?: string;
  role?: string;
}

// --- Pendientes ---

export type TaskStatus = 'pendiente' | 'en_progreso' | 'bloqueado' | 'hecho';
export type TaskPriority = 'baja' | 'media' | 'alta' | 'urgente';
export type TaskOrigin = 'odoo' | 'ops' | 'local';

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  assignee?: Person;
  accountId: string;
  origin: TaskOrigin;
  project?: string;
  url?: string;
  tags: string[];
  updatedAt: string;
}

// --- Juntas ---

export type MeetingStatus = 'confirmada' | 'tentativa' | 'cancelada';

export interface Meeting {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  accountId: string;
  status: MeetingStatus;
  organizer?: Person;
  attendees: Person[];
  location?: string;
  joinUrl?: string;
  notes?: string;
}

// --- Monitoreo ---

export type MonitorKind = 'sitio' | 'api' | 'servicio' | 'proceso';
export type MonitorStatus =
  'operativo' | 'degradado' | 'caido' | 'mantenimiento' | 'desconocido';
export type MonitorEnvironment = 'produccion' | 'pruebas' | 'desarrollo';

export interface MonitorCheck {
  at: string;
  ok: boolean;
  latencyMs: number;
  statusCode?: number;
}

export interface MonitorTarget {
  id: string;
  name: string;
  kind: MonitorKind;
  url: string;
  environment: MonitorEnvironment;
  status: MonitorStatus;
  latencyMs?: number;
  uptime24h: number;
  uptime30d: number;
  lastCheck?: string;
  history: MonitorCheck[];
  incident?: string;
  accountId: string;
}

// --- CRM ---

export type CrmStage =
  'nuevo' | 'calificado' | 'propuesta' | 'negociacion' | 'ganado' | 'perdido';
export type CrmActivityType = 'llamada' | 'correo' | 'reunion' | 'tarea';

export interface CrmOpportunity {
  id: string;
  name: string;
  partner: string;
  stage: CrmStage;
  amount: number;
  currency: string;
  probability: number;
  expectedClose?: string;
  salesperson?: Person;
  accountId: string;
  url?: string;
  updatedAt: string;
}

export interface CrmActivity {
  id: string;
  summary: string;
  type: CrmActivityType;
  dueDate: string;
  responsible?: Person;
  opportunityId?: string;
  opportunityName?: string;
  accountId: string;
  url?: string;
}

// --- Licencias ---

export type LicenseProvider =
  'anthropic' | 'cursor' | 'figma' | 'vercel' | 'otro';
export type LicenseUnit = 'asientos' | 'tokens' | 'solicitudes' | 'dinero';

export interface LicenseMember {
  person: Person;
  used: number;
  active: boolean;
}

export interface LicenseUsage {
  id: string;
  provider: LicenseProvider;
  product: string;
  plan?: string;
  unit: LicenseUnit;
  used: number;
  limit?: number;
  periodStart: string;
  periodEnd: string;
  cost?: number;
  currency?: string;
  renewsAt?: string;
  manual: boolean;
  members: LicenseMember[];
  accountId: string;
  url?: string;
  updatedAt: string;
}

// --- Despliegues ---

export type DeploymentState =
  'listo' | 'construyendo' | 'en_cola' | 'error' | 'cancelado';
export type DeploymentEnvironment = 'produccion' | 'vista_previa';

export interface Deployment {
  id: string;
  project: string;
  url: string;
  state: DeploymentState;
  environment: DeploymentEnvironment;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  author?: Person;
  createdAt: string;
  readyAt?: string;
  durationSeconds?: number;
  inspectorUrl?: string;
  accountId: string;
}

export type PlatformIndicator =
  'operativo' | 'menor' | 'mayor' | 'critico' | 'mantenimiento' | 'desconocido';

export interface PlatformStatus {
  id: string;
  label: string;
  indicator: PlatformIndicator;
  description: string;
  url?: string;
  checkedAt: string;
  accountId: string;
}
