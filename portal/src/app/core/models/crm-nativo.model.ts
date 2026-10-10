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
  | 'cancelado';

export const CRM_PROYECTO_ESTADO_LABEL: Record<CrmProyectoEstado, string> = {
  prospecto: 'Prospecto',
  en_cotizacion: 'En cotización',
  aprobado: 'Aprobado',
  en_desarrollo: 'En desarrollo',
  en_pruebas: 'En pruebas',
  entregado: 'Entregado',
  en_soporte: 'En soporte',
  pausado: 'Pausado',
  cancelado: 'Cancelado'
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

/** Esquema de cobro de una cotización. */
export type CrmEsquemaCobro = 'unico' | 'parcialidades' | 'mensual';

export const CRM_ESQUEMA_COBRO_LABEL: Record<CrmEsquemaCobro, string> = {
  unico: 'Pago único',
  parcialidades: 'Parcialidades',
  mensual: 'Mensual'
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
  /** Proyecto al que pertenece. */
  proyectoId: string;
  /** Folio (ej. DS-2026-042, NQ-2026-015). */
  folio?: string;
  /** Versión de la cotización (1, 2, 3...). */
  version?: number;
  /** Empresa del grupo que factura ESTA cotización. */
  empresaFacturaId?: string;
  nombre: string;
  fechaEmision?: string;
  /** Días de vigencia desde emisión. */
  vigenciaDias?: number;
  /** Fecha de vencimiento calculada o fija. */
  fechaVencimiento?: string;
  subtotal: number;
  iva: number;
  total: number;
  moneda: string;
  esquemaCobro: CrmEsquemaCobro;
  estatus: CrmCotizacionEstatus;
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
  actualizadoEn: string;
}

/** Estado de un pago programado. */
export type CrmPagoEstatus =
  'por_facturar' | 'facturado' | 'pagado' | 'vencido';

export const CRM_PAGO_ESTATUS_LABEL: Record<CrmPagoEstatus, string> = {
  por_facturar: 'Por facturar',
  facturado: 'Facturado',
  pagado: 'Pagado',
  vencido: 'Vencido'
};

/** Un pago programado (parcialidad o mensualidad). */
export interface CrmPagoProgramado {
  id: string;
  cotizacionId: string;
  /** Número de pago (1 de 3, 2 de 3, etc.). */
  numero: number;
  /** Total de pagos de esta cotización. */
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
