/**
 * Una llamada (junta grabada con Fireflies) cuyo texto completo ya quedo en
 * un Google Doc dentro de la carpeta de Drive del monitor. Mismo contrato que
 * en puente/src/nucleo/contrato.ts.
 */
export interface LlamadaArchivada {
  /** El id de la transcripción en Fireflies. */
  id: string;
  titulo: string;
  /** Cuándo fue la llamada (ISO). */
  fecha: string;
  duracionMin?: number;
  participantes: string[];
  resumen?: string;
  /** Liga para abrir el Google Doc. */
  docUrl: string;
  docId: string;
  /** Cuándo se guardó en Drive (ISO). */
  archivadaEn: string;
  /** Ya se borró de Fireflies para liberar espacio. */
  borradaDeFireflies: boolean;
}
