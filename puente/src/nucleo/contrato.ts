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
  /** Se le pide estatus de sus pendientes (correo con su liga personal). */
  pedirEstatus?: boolean;
}

// --- Pendientes ---

export type TaskStatus = 'pendiente' | 'en_progreso' | 'bloqueado' | 'hecho';
export type TaskPriority = 'baja' | 'media' | 'alta' | 'urgente';
export type TaskOrigin = 'odoo' | 'ops' | 'local' | 'correo';

/** De quien viene un pendiente de correo. */
export type SenderKind = 'empresa' | 'equipo' | 'por_identificar';

/** Un comentario puesto desde el portal sobre un pendiente. */
export interface TaskComment {
  text: string;
  at: string;
  by?: string;
}

/** Un movimiento en la vida de un pendiente: quien, cuando y que. */
export interface TaskEvent {
  at: string;
  by?: string;
  kind:
    | 'comentario'
    | 'estado'
    | 'asignacion'
    | 'edicion'
    | 'eliminado'
    | 'solicitud';
  text: string;
}

/** Alguien del equipo pidio, desde su liga, que le quiten un pendiente. */
export interface ReassignRequest {
  /** Quien lo pide (nombre). */
  by: string;
  reason?: string;
  at: string;
}

/** Llego algo nuevo al pendiente (un correo relacionado) y nadie lo ha visto. */
export interface TaskUnread {
  at: string;
  /** Resumen corto de lo que llego. */
  text: string;
}

/** La IA propone responsable; alguien decide si se asigna. */
export interface SuggestedAssignee {
  person: Person;
  reason: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  /** Comentarios capturados en el portal, el más reciente al final. */
  comments?: TaskComment[];
  /** Trazabilidad: comentarios, cambios de estado, asignaciones y ediciones. */
  history?: TaskEvent[];
  /** Empresa a la que pertenece: Itech Dev, Dealer Solutions, NexusQTech, OperativAI. */
  company?: string;
  /** Personal, no del negocio: solo se ve en Personales. */
  personal?: boolean;
  /** Otras cuentas donde llego el mismo pendiente. */
  alsoIn?: string[];
  /**
   * Quien lo pide, para los que vienen del correo: una empresa (proveedor o
   * cliente), alguien de las empresas propias, o por identificar.
   */
  senderKind?: SenderKind;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string;
  /** La fecha lleva hora concreta; si no, es "para ese dia". */
  dueHasTime?: boolean;
  assignee?: Person;
  /** Quienes tambien le dan seguimiento, ademas del responsable. */
  followers?: Person[];
  /** Responsable que propone la IA, todavia sin asignar. */
  suggestedAssignee?: SuggestedAssignee;
  /** Novedad por correo que nadie ha abierto todavia. */
  unread?: TaskUnread;
  /** El responsable pidio que se lo reasignen; pendiente de decidir. */
  reassignRequest?: ReassignRequest;
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
  /** Otras cuentas donde aparece la misma junta (ver homologar). */
  alsoIn?: string[];
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

// --- Repositorios ---

export type RepoCheckState =
  'exitoso' | 'fallido' | 'en_curso' | 'sin_revision';
export type RepoReviewState =
  'aprobado' | 'cambios_solicitados' | 'sin_revisar';

export interface RepoCommit {
  sha: string;
  message?: string;
  author?: Person;
  at: string;
  url?: string;
}

export interface RepoPullRequest {
  number: number;
  title: string;
  url: string;
  author?: Person;
  createdAt: string;
  updatedAt?: string;
  draft: boolean;
  reviewState: RepoReviewState;
  checkState: RepoCheckState;
}

export interface RepoStatus {
  id: string;
  name: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  lastCommit?: RepoCommit;
  checkState: RepoCheckState;
  openPullRequests: RepoPullRequest[];
  openIssues: number;
  pushedAt?: string;
  accountId: string;
  updatedAt: string;
}

// --- Servidores (VPS) con Prometheus ---

export type VpsHealth = 'bien' | 'aviso' | 'critico' | 'sin_senal';

export interface VpsPoint {
  at: string;
  value: number;
}

export interface VpsContainer {
  name: string;
  running: boolean;
  cpuPct?: number;
  memMb?: number;
  lastSeen: string;
}

export interface VpsStatus {
  /** El host (instancia sin puerto) o la etiqueta de nombre. */
  id: string;
  name: string;
  online: boolean;
  health: VpsHealth;
  /** Que disparo el aviso o el critico, en palabras. */
  reason?: string;
  cpuPct?: number;
  cores?: number;
  load1?: number;
  memPct?: number;
  memUsedMb?: number;
  memTotalMb?: number;
  diskPct?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  netRxBps?: number;
  netTxBps?: number;
  uptimeSeconds?: number;
  lastSeen?: string;
  /** Ultimas horas, para la grafica. */
  cpuHistory: VpsPoint[];
  memHistory: VpsPoint[];
  containers: VpsContainer[];
  accountId: string;
}

// --- Portales montados en Coolify ---

export type HostedAppStatus = 'running' | 'stopped' | 'error' | 'unknown';

/** Una aplicacion o servicio montado en Coolify. */
export interface HostedApp {
  id: string;
  name: string;
  kind: 'app' | 'service';
  status: HostedAppStatus;
  /** Lo que dice Coolify tal cual, por ejemplo "running:healthy". */
  rawStatus?: string;
  /** Sano segun el healthcheck, si Coolify lo reporta. */
  healthy?: boolean;
  url?: string;
  server?: string;
  project?: string;
  environment?: string;
  repo?: string;
  branch?: string;
  lastDeployAt?: string;
  lastDeployStatus?: string;
  updatedAt?: string;
  accountId: string;
}
