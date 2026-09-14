/**
 * Lo que el puente espera RECIBIR.
 *
 * Hay dos maneras de traer datos: ir por ellos (los adaptadores de
 * `proveedores/`) o recibirlos. Esta es la segunda, y es la que va a dominar:
 * el sistema de origen empuja cuando algo cambia, en lugar de que el puente
 * pregunte cada minuto por si acaso.
 *
 * Estos tipos NO son los del portal a proposito. Quien manda datos no tiene por
 * que conocer los adentros del portal: manda lo que naturalmente sabe, con
 * nombres en español y casi todo opcional, y el puente completa lo demas
 * (`accountId`, valores por omision, identificadores con prefijo). Asi el
 * modelo del portal puede cambiar sin romperle el envio a nadie.
 */

/** Quien manda datos se identifica por su token, nunca por el cuerpo. */
export type TipoIngesta =
  | 'pendientes'
  | 'juntas'
  | 'monitoreo'
  | 'crm'
  | 'licencias'
  | 'despliegues'
  | 'repos';

export const TIPOS_INGESTA: TipoIngesta[] = [
  'pendientes',
  'juntas',
  'monitoreo',
  'crm',
  'licencias',
  'despliegues',
  'repos'
];

/**
 * Como tratar lo que llega.
 *
 * - `reemplazar` (por omision): esto es el estado completo de ese origen. Lo
 *   que no venga en este envio se considera que ya no existe. Es lo correcto
 *   para un envio periodico que manda toda su lista.
 * - `agregar`: mezcla por identificador sobre lo que ya habia. Es lo correcto
 *   para un evento suelto, como "termino este despliegue".
 *
 * La diferencia importa: si un webhook de un solo despliegue llegara en modo
 * reemplazar, borraria los otros cinco.
 */
export type ModoIngesta = 'reemplazar' | 'agregar';

/** El sobre que envuelve a todos los envios. */
export interface SobreIngesta<T> {
  /** Version del contrato. Hoy siempre 1. */
  version: number;
  modo?: ModoIngesta;
  /**
   * Cuando se midio el dato, no cuando llego. Sirve para descartar envios que
   * lleguen fuera de orden, que con reintentos y webhooks pasa seguido.
   */
  generadoEn?: string;
  datos: T;
}

export interface PersonaEntrante {
  /** Si no viene, se usa el correo o el nombre. */
  id?: string;
  nombre: string;
  correo?: string;
  rol?: string;
}

// --- Pendientes ---

export interface PendienteEntrante {
  /** Identificador en el sistema de origen. El puente le pone prefijo. */
  id: string;
  titulo: string;
  descripcion?: string;
  /** Por omision `pendiente`. */
  estado?: 'pendiente' | 'en_progreso' | 'bloqueado' | 'hecho';
  /** Por omision `media`. */
  prioridad?: 'baja' | 'media' | 'alta' | 'urgente';
  /** Fecha compromiso en ISO. Sin ella el pendiente sale como "sin fecha". */
  venceEn?: string;
  responsable?: PersonaEntrante;
  proyecto?: string;
  url?: string;
  etiquetas?: string[];
  actualizadoEn?: string;
}

// --- Juntas ---

export interface JuntaEntrante {
  id: string;
  titulo: string;
  /** Inicio en ISO. Es el unico dato de tiempo obligatorio. */
  inicio: string;
  /** Si no viene, se asume una hora despues del inicio. */
  fin?: string;
  todoElDia?: boolean;
  /** Por omision `confirmada`. */
  estado?: 'confirmada' | 'tentativa' | 'cancelada';
  organizador?: PersonaEntrante;
  asistentes?: PersonaEntrante[];
  lugar?: string;
  /** Liga de la videollamada. */
  enlace?: string;
  notas?: string;
}

// --- Monitoreo ---

/**
 * Una revision suelta de un destino.
 *
 * Quien vigila manda el resultado de cada revision; el puente arma el historial
 * y calcula la disponibilidad. Asi el emisor puede ser un script de tres lineas
 * en lugar de tener que llevar estadisticas.
 */
export interface RevisionEntrante {
  /** Identificador estable del destino: con el se agrupa el historial. */
  id: string;
  nombre: string;
  url: string;
  tipo?: 'sitio' | 'api' | 'servicio' | 'proceso';
  entorno?: 'produccion' | 'pruebas' | 'desarrollo';
  ok: boolean;
  latenciaMs?: number;
  codigo?: number;
  revisadoEn?: string;
  /** Que paso, si no esta bien. */
  incidente?: string;
  /** En mantenimiento programado no se reporta como caido. */
  enMantenimiento?: boolean;
}

// --- CRM ---

export interface OportunidadEntrante {
  id: string;
  nombre: string;
  cliente: string;
  /** Por omision `nuevo`. Se acepta el nombre de la etapa del sistema origen. */
  etapa?: string;
  importe?: number;
  moneda?: string;
  /** De 0 a 100. */
  probabilidad?: number;
  cierreEsperado?: string;
  vendedor?: PersonaEntrante;
  url?: string;
  actualizadoEn?: string;
}

export interface ActividadEntrante {
  id: string;
  resumen: string;
  /** Se acepta el nombre del sistema origen; el puente lo clasifica. */
  tipo?: string;
  venceEn: string;
  responsable?: PersonaEntrante;
  oportunidadId?: string;
  oportunidadNombre?: string;
  url?: string;
}

export interface CrmEntrante {
  oportunidades?: OportunidadEntrante[];
  actividades?: ActividadEntrante[];
}

// --- Licencias ---

export interface MiembroLicenciaEntrante {
  persona: PersonaEntrante;
  /** Consumo en la unidad de la licencia. Por omision 1 (un asiento). */
  usado?: number;
  /** Por omision true. False marca al que ocupa asiento y no lo usa. */
  activo?: boolean;
}

export interface LicenciaEntrante {
  id: string;
  producto: string;
  proveedor?: 'anthropic' | 'cursor' | 'figma' | 'vercel' | 'otro';
  plan?: string;
  unidad: 'asientos' | 'tokens' | 'solicitudes' | 'dinero';
  usado: number;
  /** Tope contratado. Sin el, se entiende pago por consumo. */
  tope?: number;
  periodoInicio?: string;
  periodoFin?: string;
  costo?: number;
  moneda?: string;
  renuevaEn?: string;
  /**
   * True cuando el dato lo escribio una persona y no salio del proveedor. El
   * portal lo etiqueta como capturado a mano en vez de presentarlo como vivo.
   */
  capturadoAMano?: boolean;
  miembros?: MiembroLicenciaEntrante[];
  url?: string;
}

// --- Despliegues ---

export interface DespliegueEntrante {
  id: string;
  proyecto: string;
  url?: string;
  /** Se acepta el vocabulario del proveedor; el puente lo traduce. */
  estado: string;
  entorno?: 'produccion' | 'vista_previa';
  rama?: string;
  commit?: string;
  mensaje?: string;
  autor?: PersonaEntrante;
  creadoEn: string;
  listoEn?: string;
  duracionSegundos?: number;
  enlaceDetalle?: string;
}

// --- Repositorios ---

export interface PullRequestEntrante {
  numero: number;
  titulo: string;
  url: string;
  autor?: PersonaEntrante;
  creadoEn: string;
  actualizadoEn?: string;
  borrador?: boolean;
  /** Por omision `sin_revisar`. */
  revision?: 'aprobado' | 'cambios_solicitados' | 'sin_revisar';
  /** Estado de la integracion continua de esa rama. */
  integracion?: 'exitoso' | 'fallido' | 'en_curso' | 'sin_revision';
}

export interface RepoEntrante {
  /** "propietario/repositorio". Sirve tambien de identificador. */
  nombre: string;
  url: string;
  privado?: boolean;
  ramaPrincipal?: string;
  ultimoCommit?: {
    sha: string;
    mensaje?: string;
    autor?: PersonaEntrante;
    fecha: string;
    url?: string;
  };
  /** Estado de la integracion continua de la rama principal. */
  integracion?: 'exitoso' | 'fallido' | 'en_curso' | 'sin_revision';
  pullRequests?: PullRequestEntrante[];
  issuesAbiertos?: number;
  ultimoPushEn?: string;
}

/** Lo que lleva el campo `datos` segun el tipo de envio. */
export interface DatosPorTipo {
  pendientes: PendienteEntrante[];
  juntas: JuntaEntrante[];
  monitoreo: RevisionEntrante[];
  crm: CrmEntrante;
  licencias: LicenciaEntrante[];
  despliegues: DespliegueEntrante[];
  repos: RepoEntrante[];
}
