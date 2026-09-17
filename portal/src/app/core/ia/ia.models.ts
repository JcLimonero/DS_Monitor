import { Meeting, Person, TaskPriority } from '../models';

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
}

export type JuntaParaAcuerdos = Pick<
  Meeting,
  'id' | 'title' | 'start' | 'end' | 'organizer' | 'attendees' | 'notes'
>;

export const EMPRESAS = [
  'Itech Dev',
  'Dealer Solutions',
  'NexusQTech',
  'OperativAI'
] as const;
