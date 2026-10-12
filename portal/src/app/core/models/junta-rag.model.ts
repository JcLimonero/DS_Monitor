/**
 * Junta de Fireflies guardada para el RAG. Mismo contrato que
 * puente/src/nucleo/contrato.ts.
 */
export type JuntaRagEstado = 'sin_asignar' | 'archivada';

export interface JuntaRag {
  /** Id de la transcripción en Fireflies. */
  id: string;
  titulo: string;
  /** Cuándo fue la junta (ISO). */
  fecha: string;
  duracionMin?: number;
  participantes: string[];
  resumen?: string;
  /** Markdown completo, para búsquedas. */
  texto: string;
  empresaId?: string;
  empresaNombre?: string;
  clienteId?: string;
  clienteNombre?: string;
  proyectoId?: string;
  proyectoNombre?: string;
  driveFileId?: string;
  driveUrl?: string;
  firefliesUrl?: string;
  estado: JuntaRagEstado;
  /**
   * Junta de Itech Dev. Se archiva en su carpeta y genera el pendiente
   * `fireflies-{id}`, pero no entra al CRM nativo.
   */
  esItech: boolean;
  /** Por qué quedó sin asignar, o el último problema al archivar. */
  motivo?: string;
  /** Huella del Markdown: si cambia, se actualiza el archivo. */
  huella?: string;
  archivadaEn?: string;
  /** El archivo de Drive ya se comprobó. */
  driveConfirmado: boolean;
  borradaDeFireflies: boolean;
  actualizadoEn: string;
}
