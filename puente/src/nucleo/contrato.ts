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

/**
 * Llego algo nuevo al pendiente y nadie lo ha visto: un correo relacionado,
 * la respuesta de alguien del equipo desde su liga, o un pendiente recien
 * creado (p. ej. la junta de Fireflies) que nadie ha abierto.
 */
export interface TaskUnread {
  at: string;
  /** Resumen corto de lo que llego. */
  text: string;
  /** De donde viene; sin valor, correo (lo de antes). */
  kind?: 'correo' | 'respuesta' | 'nuevo';
}

/**
 * Un acuerdo dentro de un pendiente padre (junta de Fireflies): se puede
 * convertir en pendiente propio cuando el dueno del monitor lo decida.
 */
export interface TaskSubtarea {
  id: string;
  titulo: string;
  /** Cero, uno o varios del equipo; vacio si no se emparejo. */
  responsables?: Person[];
  /** Ya se convirtio en pendiente propio. */
  convertida?: boolean;
  /** Id del pendiente creado al convertir. */
  pendienteId?: string;
  /** Nombre crudo de Fireflies si no emparejo con el equipo. */
  responsableEtiqueta?: string;
}

/** Se le pidio una actualizacion a los responsables y no han contestado. */
export interface UpdateRequest {
  at: string;
  /** Correos a los que se les pidio. */
  to: string[];
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
  /**
   * Fotos del detalle (data URLs de imagen). Van con el pendiente propio y
   * se muestran en la tarjeta y en /mio.
   */
  imagenes?: string[];
  /** Comentarios capturados en el portal, el más reciente al final. */
  comments?: TaskComment[];
  /** Trazabilidad: comentarios, cambios de estado, asignaciones y ediciones. */
  history?: TaskEvent[];
  /** Empresa a la que pertenece: el nombre de una del catalogo (Integraciones → Empresas). */
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
  /** Se pidio actualizacion a los responsables; se borra cuando contestan. */
  updateRequested?: UpdateRequest;
  /**
   * Acuerdos de una junta (Fireflies): viven en el pendiente padre hasta que
   * alguien los convierte en pendientes propios.
   */
  subtareas?: TaskSubtarea[];
  accountId: string;
  origin: TaskOrigin;
  /**
   * Cliente o proveedor externo: el nombre de uno del catalogo
   * (Integraciones → Proveedores).
   */
  project?: string;
  url?: string;
  tags: string[];
  updatedAt: string;
}

// --- Empresas ---

/**
 * Una empresa del grupo, del catalogo que se edita en Integraciones →
 * Empresas. El nombre es la etiqueta con la que se marcan los pendientes
 * (`TaskItem.company`); las cuentas son los buzones o fuentes que le
 * pertenecen, para que lo que llega por ahi se etiquete solo.
 */
export interface Empresa {
  id: string;
  nombre: string;
  /** Que hace, en una frase: es lo que se le cuenta al modelo. */
  descripcion?: string;
  /** Color de la etiqueta, en nombre de Tailwind (por ejemplo "violet"). */
  color?: string;
  /** Ids de los buzones o fuentes (`accountId`) que le pertenecen. */
  cuentas: string[];
  /** Inactiva: no se ofrece en selectores ni al modelo, pero conserva lo etiquetado. */
  activa: boolean;
  orden: number;
  actualizadoEn: string;
}

// --- Proveedores ---

/**
 * Un proveedor o cliente externo, del catalogo que se edita en
 * Integraciones → Proveedores. El nombre es la etiqueta con la que se
 * marcan los pendientes (`TaskItem.project`).
 */
export interface Proveedor {
  id: string;
  nombre: string;
  /** Que es, en una frase: es lo que se le cuenta al modelo. */
  descripcion?: string;
  /** Color de la etiqueta, en nombre de Tailwind (por ejemplo "sky"). */
  color?: string;
  /** Inactivo: no se ofrece en selectores ni al modelo, pero conserva lo etiquetado. */
  activa: boolean;
  orden: number;
  actualizadoEn: string;
}

// --- Llamadas archivadas ---

/**
 * Una llamada (junta grabada con Fireflies) cuyo texto completo ya quedo en
 * un Google Doc dentro de la carpeta de Drive del monitor. Mismo contrato que
 * en portal/src/app/core/models/llamada.model.ts.
 */
export interface LlamadaArchivada {
  /** El id de la transcripcion en Fireflies. */
  id: string;
  titulo: string;
  /** Cuando fue la llamada (ISO). */
  fecha: string;
  duracionMin?: number;
  participantes: string[];
  resumen?: string;
  /** Liga para abrir el Google Doc. */
  docUrl: string;
  docId: string;
  /** Cuando se guardo en Drive (ISO). */
  archivadaEn: string;
  /** Ya se borro de Fireflies para liberar espacio. */
  borradaDeFireflies: boolean;
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
  /** Pista breve de qué revisar, según el último chequeo. */
  sugerencia?: string;
  accountId: string;
}

// --- CRM ---

export type CrmStage =
  'nuevo' | 'calificado' | 'propuesta' | 'negociacion' | 'ganado' | 'perdido';
export type CrmActivityType = 'llamada' | 'correo' | 'reunion' | 'tarea';

/**
 * Movimiento de etapa hecho a mano desde el tablero que el emisor todavia no
 * confirma: mientras tanto `stage` es la etapa manual.
 */
export interface CrmStageManual {
  by: string;
  at: string;
  /** La etapa que el emisor sigue mandando. */
  reported: CrmStage;
}

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
  /** Viene de un emisor (/ingesta/crm): su etapa se puede mover desde el tablero. */
  ingested?: boolean;
  /** Ultimo cambio de etapa que el puente vio (del emisor o a mano). */
  stageChangedAt?: string;
  /** Ultimo movimiento: el cambio de etapa o la ultima actividad nueva ligada. */
  lastMovementAt?: string;
  stageManual?: CrmStageManual;
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

// --- CRM nativo (clientes propios del grupo) ---

/** Tipo de cliente: directo, intermediario (factura por otro) o final. */
export type CrmClienteTipo = 'directo' | 'intermediario' | 'final';

/**
 * Un cliente del CRM nativo: vive en el puente, no en Odoo.
 * Empresas: TechCorp, InnovateLabs, CloudWorks, DevHub.
 */
export interface CrmCliente {
  id: string;
  nombre: string;
  razonSocial?: string;
  rfc?: string;
  /** directo = factura y paga; intermediario = factura a un final; final = paga un intermediario. */
  tipo: CrmClienteTipo;
  /**
   * Si este cliente es final, el intermediario que le factura.
   * Ej: TechCorp factura a Distribuidora XYZ → cliente final es Corporativo ABC.
   */
  clienteFacturacionId?: string;
  /** Carpeta en Drive del cliente. */
  driveFolderUrl?: string;
  notas?: string;
  actualizadoEn: string;
}

/** Un contacto de un cliente del CRM nativo. */
export interface CrmContacto {
  id: string;
  clienteId: string;
  nombre: string;
  puesto?: string;
  correo?: string;
  telefono?: string;
  /** Responsable del lado del cliente para proyectos (a quien se mandan cotizaciones). */
  esResponsableProyecto: boolean;
  actualizadoEn: string;
}

/** Estado de un proyecto del CRM nativo. */
export type CrmProyectoEstado =
  | 'prospecto'
  | 'en_cotizacion'
  | 'aprobado'
  | 'en_desarrollo'
  | 'en_pruebas'
  | 'entregado'
  | 'en_soporte'
  | 'pausado'
  | 'cancelado';

/** Un proyecto de un cliente del CRM nativo. */
export interface CrmProyecto {
  id: string;
  /** Cliente que paga (puede ser intermediario). */
  clienteId: string;
  /** Cliente final si el que paga es intermediario. */
  clienteFinalId?: string;
  /** Empresa del grupo que atiende (TechCorp, InnovateLabs, etc.). */
  empresaAtiendeId?: string;
  nombre: string;
  alcance?: string;
  /** Responsable interno (alguien del equipo). */
  responsableInterno?: Person;
  /** Contacto del cliente que es responsable del proyecto. */
  responsableClienteId?: string;
  fechaInicio?: string;
  fechaFinEstimada?: string;
  estado: CrmProyectoEstado;
  /** Porcentaje de avance (0–100). */
  avancePct?: number;
  /** Carpeta en Drive del proyecto. */
  driveUrl?: string;
  /** URLs de repositorios. */
  repos?: string[];
  notas?: string;
  actualizadoEn: string;
}

/** Esquema de cobro de una cotizacion. */
export type CrmEsquemaCobro = 'unico' | 'parcialidades' | 'mensual';

/** Estado de una cotizacion. */
export type CrmCotizacionEstatus =
  | 'borrador'
  | 'enviada'
  | 'aprobada'
  | 'rechazada'
  | 'vencida'
  | 'obsoleta'
  | 'desconocido';

/** Una cotizacion del CRM nativo. */
export interface CrmCotizacion {
  id: string;
  /** Proyecto al que pertenece. */
  proyectoId: string;
  /** Folio (ej. DS-2026-042, NQ-2026-015). */
  folio?: string;
  /** Version de la cotizacion (1, 2, 3...). */
  version?: number;
  /** Empresa del grupo que factura ESTA cotizacion. */
  empresaFacturaId?: string;
  nombre: string;
  fechaEmision?: string;
  /** Dias de vigencia desde emision. */
  vigenciaDias?: number;
  /** Fecha de vencimiento calculada o fija. */
  fechaVencimiento?: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  esquemaCobro: CrmEsquemaCobro;
  estatus: CrmCotizacionEstatus;
  /** Cuando se envio al cliente. */
  fechaEnvio?: string;
  /** Contacto al que se envio. */
  enviadaAId?: string;
  /** Cuando Carlos autorizo el envio (obligatorio antes de enviar). */
  autorizadaPorCarlosEn?: string;
  /** Cuando el cliente aprobo. */
  fechaAprobacion?: string;
  /** Nombre de quien aprobo del lado del cliente. */
  aprobadoPor?: string;
  /** Numero de orden de compra del cliente. */
  ordenCompra?: string;
  /** URL del PDF de la cotizacion. */
  pdfUrl?: string;
  /** Liga con una cotizacion de ingesta si corresponde. */
  cotizacionExternaId?: string;
  actualizadoEn: string;
}

/** Estado de un pago programado. */
export type CrmPagoEstatus =
  'por_facturar' | 'facturado' | 'pagado' | 'vencido';

/** Un pago programado (parcialidad o mensualidad). */
export interface CrmPagoProgramado {
  id: string;
  cotizacionId: string;
  /** Numero de pago (1 de 3, 2 de 3, etc.). */
  numero: number;
  /** Total de pagos de esta cotizacion. */
  totalPagos: number;
  monto: number;
  moneda: string;
  fechaEsperada: string;
  estatus: CrmPagoEstatus;
  /** Fecha real de pago. */
  fechaPagoReal?: string;
  /** Nota (ej. "Octubre 2026"). */
  nota?: string;
  actualizadoEn: string;
}

/** Tipo de actividad en la bitacora de un cliente. */
export type CrmActividadClienteTipo = 'llamada' | 'junta' | 'correo' | 'nota';

/** Proximo paso de una actividad: genera un pendiente en Pendientes. */
export interface CrmProximoPaso {
  descripcion: string;
  fecha: string;
}

/** Una actividad en la bitacora de un cliente. */
export interface CrmActividadCliente {
  id: string;
  clienteId: string;
  /** Proyecto relacionado (opcional). */
  proyectoId?: string;
  /** Cotizacion relacionada (opcional). */
  cotizacionId?: string;
  tipo: CrmActividadClienteTipo;
  resumen: string;
  fecha: string;
  proximoPaso?: CrmProximoPaso;
  responsable?: Person;
  actualizadoEn: string;
}

/** Estado de una funcionalidad en desarrollo. */
export type CrmFuncionalidadEstado =
  'por_hacer' | 'en_progreso' | 'en_revision' | 'hecho' | 'bloqueado';

/** Prioridad de una funcionalidad. */
export type CrmFuncionalidadPrioridad = 'baja' | 'media' | 'alta' | 'urgente';

/**
 * Una funcionalidad o tarea de desarrollo dentro de un proyecto.
 * Permite llevar el control del avance real del proyecto.
 */
export interface CrmFuncionalidad {
  id: string;
  proyectoId: string;
  titulo: string;
  descripcion?: string;
  estado: CrmFuncionalidadEstado;
  /** Id del responsable interno (del catalogo de Equipo). */
  responsableId?: string;
  prioridad: CrmFuncionalidadPrioridad;
  /** Fecha compromiso de entrega. */
  fechaCompromiso?: string;
  /** Enlace a repo, PR, issue, etc. */
  enlace?: string;
  /** Id del pendiente existente ligado (si aplica). */
  pendienteId?: string;
  /** Orden dentro del proyecto (para drag & drop). */
  orden?: number;
  actualizadoEn: string;
}

// --- Control de acceso por roles ---

/**
 * Areas del sistema que se pueden proteger.
 * Las areas personales de Carlos (licencias, correo, servidores, integraciones,
 * configuracion) son solo para Director.
 */
export type AreaPermiso =
  | 'clientes'
  | 'proyectos'
  | 'cotizaciones'
  | 'cobranza'
  | 'costos'
  | 'desarrollo'
  | 'actividades'
  | 'equipo'
  | 'licencias'
  | 'correo'
  | 'servidores'
  | 'integraciones'
  | 'configuracion';

/** Nivel de acceso a un area. */
export type NivelAcceso = 'ninguno' | 'lectura' | 'escritura';

/**
 * Un rol configurable con permisos por area.
 * Los roles de fabrica (esSistema) no se pueden borrar.
 */
export interface RolCrm {
  id: string;
  nombre: string;
  descripcion?: string;
  /** Permisos por area; lo que no esta es 'ninguno'. */
  permisos: Partial<Record<AreaPermiso, NivelAcceso>>;
  /** Los de fabrica no se pueden borrar. */
  esSistema: boolean;
  actualizadoEn: string;
}

/**
 * Un usuario del CRM con roles y alcance.
 * Se suma al acceso por codigo de correo (ACCESO_CORREOS) y al equipo.
 */
export interface UsuarioCrm {
  id: string;
  correo: string;
  nombre: string;
  /** IDs de los roles asignados (un usuario puede tener varios). */
  roles: string[];
  /**
   * Alcance limitado: si no esta definido, ve todo lo que su rol permita.
   * Si esta definido, solo ve los registros de esas empresas/clientes/proyectos.
   */
  alcance?: {
    empresas?: string[];
    clientes?: string[];
    proyectos?: string[];
  };
  activo: boolean;
  actualizadoEn: string;
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
  /** Cuando alguien confirmo que ya se renovo (ISO). */
  renewedAt?: string;
  /** Correo de quien confirmo la renovacion. */
  renewalConfirmedBy?: string;
  manual: boolean;
  members: LicenseMember[];
  accountId: string;
  url?: string;
  updatedAt: string;
}

/** Cada cuanto se paga una licencia capturada a mano. */
export type ManualLicensePeriod = 'mensual' | 'anual' | 'otro';

/** Una licencia que se capturo a mano: vive en el puente, no en un navegador. */
export interface ManualLicense extends LicenseUsage {
  manual: true;
  period: ManualLicensePeriod;
  notes?: string;
}

/** Una confirmacion de renovacion, para el historial de la licencia. */
export interface LicenseRenewal {
  /** Cuando se confirmo (ISO). */
  at: string;
  /** Correo de quien la confirmo. */
  by: string;
  cost?: number;
  currency?: string;
  /** La fecha de la siguiente renovacion que quedo. */
  renewsAt?: string;
  note?: string;
}

/**
 * Lo que se corrige o confirma de una licencia (de una fuente o manual) y
 * queda en el puente, encima de lo que mande el proveedor.
 */
export interface LicenseAdjustment {
  cost?: number;
  currency?: string;
  plan?: string;
  renewsAt?: string;
  /** True para sacarla del tablero sin borrarla de la fuente. */
  hidden?: boolean;
  renewedAt?: string;
  confirmedBy?: string;
  /** Las ultimas confirmaciones; la mas reciente al final (maximo 24). */
  history: LicenseRenewal[];
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
