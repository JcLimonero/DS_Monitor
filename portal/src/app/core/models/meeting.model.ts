import { Person } from './common.model';

export type MeetingStatus = 'confirmada' | 'tentativa' | 'cancelada';

export interface Meeting {
  id: string;
  title: string;
  /** Inicio y fin en ISO con zona horaria. */
  start: string;
  end: string;
  allDay: boolean;
  accountId: string;
  status: MeetingStatus;
  organizer?: Person;
  attendees: Person[];
  location?: string;
  /** Liga de la videollamada, cuando la junta la trae. */
  joinUrl?: string;
  notes?: string;
}

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  confirmada: 'Confirmada',
  tentativa: 'Tentativa',
  cancelada: 'Cancelada'
};
