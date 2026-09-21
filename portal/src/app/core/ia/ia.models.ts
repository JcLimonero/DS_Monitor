import { Meeting, Person, TaskItem, TaskPriority } from '../models';

/** Lo que devuelve /ia/resumen: el resumen del día para el carrusel. */
export interface ResumenDia {
  dia: string;
  titular: string;
  lineas: string[];
  generadoEn: string;
}

export interface Alerta {
  id: string;
  tipo: 'sube' | 'duplicada' | 'sin_uso' | 'dominio' | 'renueva';
  gravedad: 'aviso' | 'grave';
  titulo: string;
  detalle: string;
  texto?: string;
  accountId?: string;
  producto: string;
}

export interface Acuerdo {
  titulo: string;
  descripcion?: string;
  responsable?: string;
  persona?: Person;
  venceEn?: string;
  prioridad: TaskPriority;
  empresa?: string;
}

export interface Borrador {
  para?: string;
  asunto: string;
  cuerpo: string;
}

export interface SugerenciaCrm {
  id: string;
  tipo: 'oportunidad' | 'queja';
  nombre: string;
  contacto?: string;
  correo?: string;
  resumen: string;
  empresa?: string;
  analizadoEn: string;
}

export interface Diagnostico {
  id: string;
  clase: 'sitio' | 'despliegue';
  objetivo: string;
  resumen: string;
  causa: string;
  accion: string;
  evidencia: string;
  generadoEn: string;
}

export interface ResumenRepos {
  semana: string;
  desde: string;
  hasta: string;
  proyectos: {
    repo: string;
    commits: number;
    autores: string[];
    lineas: string[];
  }[];
  generadoEn: string;
}

export interface SemanaPersona {
  persona: Person;
  pendientes: number;
  vencidos: number;
  juntas: number;
  apertura?: string;
  html: string;
}

export interface VistaSemana {
  ultimoEnvio: { semana?: string; enviadoEn?: string; enviados?: string[] };
  personas: SemanaPersona[];
}

export interface EstadoIa {
  activa: boolean;
  modelo?: string;
  consumo: { llamadas: number; entrada: number; salida: number };
  /** Buzones donde se pueden crear juntas (Microsoft). */
  calendarios: { id: string; usuario: string }[];
  /** Correos del dueño del monitor (acceso y buzones), en minúsculas. */
  correosDelDueno?: string[];
  fireflies: boolean;
  telegram: boolean;
}

export type JuntaParaAcuerdos = Pick<
  Meeting,
  'id' | 'title' | 'start' | 'end' | 'organizer' | 'attendees' | 'notes'
>;

// Las empresas ya no están fijas: ver core/empresas/empresas.service.ts.

/** Lo que el puente entendió de un dictado; se corrige antes de guardar. */
export interface Propuesta {
  titulo: string;
  descripcion?: string;
  personal: boolean;
  empresa?: string;
  prioridad: TaskPriority;
  venceEn?: string;
  /** venceEn trae hora dicha, no el mediodía por omisión. */
  conHora?: boolean;
  responsable?: string;
  persona?: Person;
  proyecto?: string;
  esJunta?: boolean;
  lugar?: string;
  /** Buzón en cuyo calendario crearla, si se pide. */
  agendarEn?: string;
  origen: 'ia' | 'reglas';
}

export interface NuevaJunta {
  titulo: string;
  inicio: string;
  fin?: string;
  lugar?: string;
  cuerpo?: string;
  invitados?: string[];
  enLinea?: boolean;
}

export type CambiosPendiente = Partial<
  Pick<
    TaskItem,
    | 'title'
    | 'description'
    | 'imagenes'
    | 'priority'
    | 'dueDate'
    | 'dueHasTime'
    | 'company'
    | 'project'
    | 'senderKind'
  >
>;
