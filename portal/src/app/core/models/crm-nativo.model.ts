import { Person } from './common.model';
import { CrmStage } from './crm.model';

// --- CRM nativo (clientes propios del grupo) ---

/** Tipo de cliente: directo, intermediario (factura por otro) o final. */
export type CrmClienteTipo = 'directo' | 'intermediario' | 'final';

export const CRM_CLIENTE_TIPO_LABEL: Record<CrmClienteTipo, string> = {
  directo: 'Directo',
  intermediario: 'Intermediario',
  final: 'Cliente final'
};

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
  | 'cancelado'
  | 'por_confirmar';

export const CRM_PROYECTO_ESTADO_LABEL: Record<CrmProyectoEstado, string> = {
  prospecto: 'Prospecto',
  en_cotizacion: 'En cotización',
  aprobado: 'Aprobado',
  en_desarrollo: 'En desarrollo',
  en_pruebas: 'En pruebas',
  entregado: 'Entregado',
  en_soporte: 'En soporte',
  pausado: 'Pausado',
  cancelado: 'Cancelado',
  por_confirmar: 'Por confirmar'
};

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
  /** Si no se conoce el estado, se omite o se pone 'por_confirmar'. */
  estado?: CrmProyectoEstado;
  /** Etapa comercial para el kanban (antes de ganarse). */
  etapaComercial?: CrmEtapaComercial;
  /** Cuándo entró a la etapa comercial actual. */
  enEtapaComericalDesde?: string;
  /** Responsable comercial (vendedor/consultor que lleva la cuenta). */
  responsableComercialId?: string;
  /** Porcentaje de avance (0–100). */
  avancePct?: number;
  /** Semáforo calculado contra fechas: en_tiempo, en_riesgo, atrasado. */
  semaforo?: CrmSemaforoProyecto;
  /** Carpeta en Drive del proyecto. */
  driveUrl?: string;
  /** URLs de repositorios. */
  repos?: string[];
  notas?: string;
  actualizadoEn: string;
}

/**
 * Etapa comercial para el kanban de leads/proyectos.
 * El proyecto se mueve entre estas etapas antes de ganarse.
 */
export type CrmEtapaComercial =
  | 'prospecto'
  | 'en_cotizacion'
  | 'cotizacion_enviada'
  | 'negociacion'
  | 'ganado'
  | 'perdido'
  | 'por_confirmar';

export const CRM_ETAPA_COMERCIAL_LABEL: Record<CrmEtapaComercial, string> = {
  prospecto: 'Prospecto',
  en_cotizacion: 'En cotización',
  cotizacion_enviada: 'Cotización enviada',
  negociacion: 'Negociación',
  ganado: 'Ganado',
  perdido: 'Perdido',
  por_confirmar: 'Por confirmar'
};

/** Semáforo de salud del proyecto: calculado contra fechas. */
export type CrmSemaforoProyecto = 'en_tiempo' | 'en_riesgo' | 'atrasado';

export const CRM_SEMAFORO_LABEL: Record<CrmSemaforoProyecto, string> = {
  en_tiempo: 'En tiempo',
  en_riesgo: 'En riesgo',
  atrasado: 'Atrasado'
};

// --- Kanban y seguimiento de proyectos ---

/** Fuente de un avance o cambio de estatus. */
export type CrmFuenteAvance = 'daily' | 'correo' | 'teams' | 'manual' | 'bot';

export const CRM_FUENTE_AVANCE_LABEL: Record<CrmFuenteAvance, string> = {
  daily: 'Daily',
  correo: 'Correo',
  teams: 'Teams',
  manual: 'Manual',
  bot: 'Bot'
};

/**
 * Un cambio de etapa comercial en el historial del proyecto.
 * Se registra cada vez que el proyecto se mueve en el kanban.
 */
export interface CrmCambioEtapa {
  id: string;
  proyectoId: string;
  /** Etapa anterior (undefined si es la primera). */
  etapaAnterior?: CrmEtapaComercial;
  /** Etapa nueva. */
  etapaNueva: CrmEtapaComercial;
  /** Quién hizo el cambio. */
  autor?: Person;
  /** Cuándo se hizo el cambio. */
  fecha: string;
  /** Nota opcional del cambio. */
  nota?: string;
  actualizadoEn: string;
}

/**
 * Un avance o actualización de estatus del proyecto.
 * Se registra desde dailies, correos, teams o manualmente.
 */
export interface CrmAvanceProyecto {
  id: string;
  proyectoId: string;
  /** Fecha del avance. */
  fecha: string;
  /** Nota o descripción del avance. */
  nota: string;
  /** Porcentaje de avance reportado (0–100). */
  avancePct?: number;
  /** Fuente del avance: daily, correo, teams, manual, bot. */
  fuente: CrmFuenteAvance;
  /** Quién reportó el avance. */
  autor?: Person;
  /** Cambio de estado si aplica. */
  estadoAnterior?: CrmProyectoEstado;
  estadoNuevo?: CrmProyectoEstado;
  actualizadoEn: string;
}

/**
 * Un hito o entregable del proyecto con fecha compromiso y real.
 */
export interface CrmHito {
  id: string;
  proyectoId: string;
  /** Nombre del hito/entregable. */
  nombre: string;
  /** Descripción opcional. */
  descripcion?: string;
  /** Fecha compromiso de entrega. */
  fechaCompromiso?: string;
  /** Fecha real de entrega (cuando se completó). */
  fechaReal?: string;
  /** Completado o no. */
  completado: boolean;
  /** Id del responsable interno (del catálogo de Equipo). */
  responsableId?: string;
  /** Orden para mostrar. */
  orden?: number;
  actualizadoEn: string;
}

/** Tipo de riesgo o bloqueo. */
export type CrmTipoRiesgo = 'riesgo' | 'bloqueo';

export const CRM_TIPO_RIESGO_LABEL: Record<CrmTipoRiesgo, string> = {
  riesgo: 'Riesgo',
  bloqueo: 'Bloqueo'
};

/**
 * Un riesgo o bloqueo abierto en el proyecto.
 */
export interface CrmRiesgo {
  id: string;
  proyectoId: string;
  /** Tipo: riesgo (potencial) o bloqueo (activo). */
  tipo: CrmTipoRiesgo;
  /** Descripción del riesgo/bloqueo. */
  descripcion: string;
  /** Impacto esperado. */
  impacto?: string;
  /** Plan de mitigación o acción. */
  mitigacion?: string;
  /** Quién reportó. */
  reportadoPor?: Person;
  /** Id del responsable interno de atenderlo (del catálogo de Equipo). */
  responsableId?: string;
  /** Cuándo se reportó. */
  fechaReporte: string;
  /** Abierto o cerrado. */
  abierto: boolean;
  /** Cuándo se cerró (si aplica). */
  fechaCierre?: string;
  actualizadoEn: string;
}

/** Configuración de alertas de leads estancados por etapa. */
export interface CrmAlertasEstancados {
  /** Días sin movimiento por etapa antes de alertar. */
  diasPorEtapa: Partial<Record<CrmEtapaComercial, number>>;
  /** Días por defecto si no se especifica por etapa. */
  diasDefault: number;
}

/** Alertas de estancados si nadie las configura. */
export const ALERTAS_ESTANCADOS_OMISION: CrmAlertasEstancados = {
  diasDefault: 14,
  diasPorEtapa: {
    prospecto: 21,
    en_cotizacion: 10,
    cotizacion_enviada: 7,
    negociacion: 14,
    por_confirmar: 5
  }
};

/** Esquema de cobro de una cotización. */
export type CrmEsquemaCobro =
  | 'unico'
  | 'parcialidades'
  | 'mensual'
  | 'mixto'
  | 'anual'
  | 'cuatrimestral'
  | 'bolsa_horas'
  | 'por_definir';

export const CRM_ESQUEMA_COBRO_LABEL: Record<CrmEsquemaCobro, string> = {
  unico: 'Pago único',
  parcialidades: 'Parcialidades',
  mensual: 'Mensual',
  mixto: 'Mixto',
  anual: 'Anual',
  cuatrimestral: 'Cuatrimestral',
  bolsa_horas: 'Bolsa de horas',
  por_definir: 'Por definir'
};

/** Tipo de cotización según quién es el receptor. */
export type CrmCotizacionTipo =
  /** Venta a cliente externo (ingreso). */
  | 'venta'
  /** Cotización entre empresas propias (transferencia interna). */
  | 'interna'
  /** Cotización de proveedor hacia empresa propia (gasto). */
  | 'gasto';

export const CRM_COTIZACION_TIPO_LABEL: Record<CrmCotizacionTipo, string> = {
  venta: 'Venta',
  interna: 'Interna',
  gasto: 'Gasto'
};

/** Estado de una cotización. */
export type CrmCotizacionEstatus =
  | 'borrador'
  | 'enviada'
  | 'aprobada'
  | 'rechazada'
  | 'vencida'
  | 'obsoleta'
  | 'desconocido';

export const CRM_COTIZACION_ESTATUS_LABEL: Record<
  CrmCotizacionEstatus,
  string
> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  obsoleta: 'Obsoleta',
  desconocido: 'Sin resultado'
};

/** Una cotización del CRM nativo. */
export interface CrmCotizacion {
  id: string;
  /** Cliente al que pertenece (obligatorio si no hay proyecto). */
  clienteId?: string;
  /** Proyecto al que pertenece (opcional: hay cotizaciones sin proyecto asignado). */
  proyectoId?: string;
  /** Folio (ej. DS-2026-042, NQ-2026-015). */
  folio?: string;
  /** Versión de la cotización (1, 2, 3...). */
  version?: number;
  /** Empresa del grupo que emite/factura ESTA cotización. */
  empresaFacturaId?: string;
  /** Empresa que recibe la cotización (para internas/gastos). */
  empresaReceptoraId?: string;
  /** Tipo: venta (ingreso), interna (entre empresas propias), gasto (de proveedor). */
  tipo?: CrmCotizacionTipo;
  nombre: string;
  fechaEmision?: string;
  /** Días de vigencia desde emisión. */
  vigenciaDias?: number;
  /** Fecha de vencimiento calculada o fija. */
  fechaVencimiento?: string;
  /** null = sin monto (distinto de 0). */
  subtotal?: number | null;
  /** null = sin monto o IVA por confirmar. */
  iva?: number | null;
  /** null = sin monto (distinto de 0). */
  total?: number | null;
  moneda?: string;
  /** null o 'por_definir' si no se conoce el esquema. */
  esquemaCobro?: CrmEsquemaCobro | null;
  estatus?: CrmCotizacionEstatus;
  /** Cuándo se envió al cliente. */
  fechaEnvio?: string;
  /** Contacto al que se envió. */
  enviadaAId?: string;
  /** Cuándo Carlos autorizó el envío (obligatorio antes de enviar). */
  autorizadaPorCarlosEn?: string;
  /** Cuándo el cliente aprobó. */
  fechaAprobacion?: string;
  /** Nombre de quien aprobó del lado del cliente. */
  aprobadoPor?: string;
  /** Número de orden de compra del cliente. */
  ordenCompra?: string;
  /** URL del PDF de la cotización. */
  pdfUrl?: string;
  /** Liga con una cotización de ingesta si corresponde. */
  cotizacionExternaId?: string;
  /** Notas: evidencia de estatus, texto original del esquema, 'IVA por confirmar', etc. */
  notas?: string;
  actualizadoEn: string;
}

/** Estado de un pago programado. */
export type CrmPagoEstatus =
  'por_facturar' | 'facturado' | 'pagado' | 'vencido' | 'por_confirmar';

export const CRM_PAGO_ESTATUS_LABEL: Record<CrmPagoEstatus, string> = {
  por_facturar: 'Por facturar',
  facturado: 'Facturado',
  pagado: 'Pagado',
  vencido: 'Vencido',
  por_confirmar: 'Por confirmar'
};

/** Un pago programado (parcialidad o mensualidad). */
export interface CrmPagoProgramado {
  id: string;
  /** Cotización a la que pertenece (opcional si es pago ligado a proyecto sin cotización). */
  cotizacionId?: string;
  /** Proyecto al que pertenece (para pagos sin cotización emitida, ej. mensualidades futuras). */
  proyectoId?: string;
  /** Cliente (requerido si no hay cotización ni proyecto). */
  clienteId?: string;
  /** Número de pago (1 de 3, 2 de 3, etc.). Opcional para pagos por confirmar. */
  numero?: number;
  /** Total de pagos de esta cotización. Opcional si no se conoce. */
  totalPagos?: number;
  /** null = monto por confirmar (distinto de 0). */
  monto?: number | null;
  moneda?: string;
  /** null o ausente = fecha por confirmar. */
  fechaEsperada?: string | null;
  /** true si la fecha está por confirmar. */
  fechaPorConfirmar?: boolean;
  estatus?: CrmPagoEstatus;
  /** Fecha real de pago. */
  fechaPagoReal?: string;
  /** Nota (ej. "Octubre 2026", "Mensualidad soporte"). */
  nota?: string;
  actualizadoEn: string;
}

/** Tipo de actividad en la bitácora de un cliente. */
export type CrmActividadClienteTipo = 'llamada' | 'junta' | 'correo' | 'nota';

export const CRM_ACTIVIDAD_TIPO_LABEL: Record<CrmActividadClienteTipo, string> =
  {
    llamada: 'Llamada',
    junta: 'Junta',
    correo: 'Correo',
    nota: 'Nota'
  };

/** Próximo paso de una actividad: genera un pendiente en Pendientes. */
export interface CrmProximoPaso {
  descripcion: string;
  fecha: string;
}

/** Una actividad en la bitácora de un cliente. */
export interface CrmActividadCliente {
  id: string;
  clienteId: string;
  /** Proyecto relacionado (opcional). */
  proyectoId?: string;
  /** Cotización relacionada (opcional). */
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

export const CRM_FUNCIONALIDAD_ESTADO_LABEL: Record<
  CrmFuncionalidadEstado,
  string
> = {
  por_hacer: 'Por hacer',
  en_progreso: 'En progreso',
  en_revision: 'En revisión',
  hecho: 'Hecho',
  bloqueado: 'Bloqueado'
};

/** Prioridad de una funcionalidad. */
export type CrmFuncionalidadPrioridad = 'baja' | 'media' | 'alta' | 'urgente';

export const CRM_FUNCIONALIDAD_PRIORIDAD_LABEL: Record<
  CrmFuncionalidadPrioridad,
  string
> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente'
};

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
  /** Id del responsable interno (del catálogo de Equipo). */
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

// --- Fase 2: OC, facturas y partidas ---

/**
 * Una orden de compra recurrente por cliente/mes.
 * Ligada a cliente/proyecto y opcionalmente a uno o más pagos.
 */
export interface CrmOrdenCompra {
  id: string;
  /** Cliente que emite la OC. */
  clienteId: string;
  /** Proyecto relacionado (opcional). */
  proyectoId?: string;
  /** Folio de la OC del cliente. */
  folio: string;
  /** Periodo que cubre (ej. "Octubre 2026", "Q4 2026"). */
  periodo?: string;
  /** Monto autorizado (null = por confirmar). */
  monto?: number | null;
  moneda?: string;
  /** Fecha de emisión de la OC. */
  fechaEmision?: string;
  /** Fecha de vencimiento de la OC. */
  fechaVencimiento?: string;
  /** IDs de pagos cubiertos por esta OC. */
  pagoIds?: string[];
  notas?: string;
  actualizadoEn: string;
}

/**
 * Una factura emitida, ligada a uno o más pagos.
 */
export interface CrmFactura {
  id: string;
  /** Empresa del grupo que emite la factura. */
  empresaEmisoraId: string;
  /** Cliente que recibe la factura. */
  clienteId: string;
  /** Proyecto relacionado (opcional). */
  proyectoId?: string;
  /** UUID fiscal (CFDI). */
  uuid?: string;
  /** Folio fiscal (serie + número). */
  folio?: string;
  /** Fecha de emisión. */
  fechaEmision?: string;
  /** Subtotal antes de IVA. */
  subtotal?: number | null;
  /** IVA. */
  iva?: number | null;
  /** Total con IVA. */
  total?: number | null;
  moneda?: string;
  /** Fecha de pago real de esta factura. */
  fechaPagoReal?: string;
  /** Tiene complemento de pago. */
  tieneComplemento?: boolean;
  /** Fecha del complemento de pago. */
  fechaComplemento?: string;
  /** UUID del complemento (si es diferente). */
  uuidComplemento?: string;
  /** IDs de pagos que cubre esta factura. */
  pagoIds?: string[];
  /** URL al PDF o XML de la factura. */
  archivoUrl?: string;
  notas?: string;
  actualizadoEn: string;
}

/**
 * Una partida (línea) de una cotización, con costo para calcular margen.
 * Solo visible con permiso de costos.
 */
export interface CrmPartida {
  id: string;
  cotizacionId: string;
  /** Número de línea (1, 2, 3...). */
  numero: number;
  /** Descripción o concepto. */
  descripcion: string;
  /** Cantidad (default 1). */
  cantidad?: number;
  /** Precio unitario de venta. */
  precioUnitario?: number | null;
  /** Importe de venta (cantidad * precio). */
  importe?: number | null;
  /** Costo unitario (solo con permiso de costos). */
  costoUnitario?: number | null;
  /** Costo total (solo con permiso de costos). */
  costoTotal?: number | null;
  moneda?: string;
  notas?: string;
  actualizadoEn: string;
}

// --- Control de acceso por roles ---

/**
 * Áreas del sistema que se pueden proteger.
 * Las áreas personales de Carlos (licencias, correo, servidores, integraciones,
 * configuración) son solo para Director.
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

export const AREA_PERMISO_LABEL: Record<AreaPermiso, string> = {
  clientes: 'Clientes y contactos',
  proyectos: 'Proyectos',
  cotizaciones: 'Cotizaciones (pipeline)',
  cobranza: 'Cobranza y pagos',
  costos: 'Costos y márgenes',
  desarrollo: 'Desarrollo (funcionalidades)',
  actividades: 'Actividades (bitácora)',
  equipo: 'Equipo',
  licencias: 'Licencias',
  correo: 'Correo',
  servidores: 'Servidores',
  integraciones: 'Integraciones',
  configuracion: 'Configuración'
};

/** Nivel de acceso a un área. */
export type NivelAcceso = 'ninguno' | 'lectura' | 'escritura';

export const NIVEL_ACCESO_LABEL: Record<NivelAcceso, string> = {
  ninguno: 'Sin acceso',
  lectura: 'Solo lectura',
  escritura: 'Lectura y escritura'
};

/**
 * Un rol configurable con permisos por área.
 * Los roles de fábrica (esSistema) no se pueden borrar.
 */
export interface RolCrm {
  id: string;
  nombre: string;
  descripcion?: string;
  /** Permisos por área; lo que no está es 'ninguno'. */
  permisos: Partial<Record<AreaPermiso, NivelAcceso>>;
  /** Los de fábrica no se pueden borrar. */
  esSistema: boolean;
  actualizadoEn: string;
}

/**
 * Un usuario del CRM con roles y alcance.
 * Se suma al acceso por código de correo (ACCESO_CORREOS) y al equipo.
 */
export interface UsuarioCrm {
  id: string;
  correo: string;
  nombre: string;
  /** IDs de los roles asignados (un usuario puede tener varios). */
  roles: string[];
  /**
   * Alcance limitado: si no está definido, ve todo lo que su rol permita.
   * Si está definido, solo ve los registros de esas empresas/clientes/proyectos.
   */
  alcance?: {
    empresas?: string[];
    clientes?: string[];
    proyectos?: string[];
  };
  activo: boolean;
  actualizadoEn: string;
}
