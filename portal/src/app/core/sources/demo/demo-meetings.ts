import { Meeting, MeetingStatus, Person } from '../../models';
import { addDays, addMinutes, atTime } from '../../util/date.util';
import { DEMO_PEOPLE } from './demo-people';

interface MeetingSeed {
  id: string;
  title: string;
  /** Días desde hoy. */
  dayOffset: number;
  hour: number;
  minute?: number;
  durationMinutes: number;
  status?: MeetingStatus;
  organizer?: keyof typeof DEMO_PEOPLE;
  attendees: (keyof typeof DEMO_PEOPLE)[];
  location?: string;
  joinUrl?: string;
  notes?: string;
}

/** Juntas de la cuenta de trabajo: proyecto, equipo y clientes. */
const TRABAJO_SEEDS: MeetingSeed[] = [
  {
    id: 'g-1',
    title: 'Daily del equipo de desarrollo',
    dayOffset: 0,
    hour: 9,
    durationMinutes: 15,
    organizer: 'yo',
    attendees: ['ana', 'bruno', 'carla', 'diego', 'elena'],
    joinUrl: 'https://meet.example.com/daily-desarrollo'
  },
  {
    id: 'g-2',
    title: 'Revisión de la integración con Salesforce',
    dayOffset: 0,
    hour: 11,
    durationMinutes: 60,
    organizer: 'bruno',
    attendees: ['yo', 'bruno', 'elena'],
    joinUrl: 'https://meet.example.com/integracion-sf',
    notes: 'Traer el conteo de registros en cola de reintento.'
  },
  {
    id: 'g-3',
    title: 'Demo con Grupo Delta',
    dayOffset: 0,
    hour: 16,
    durationMinutes: 45,
    status: 'tentativa',
    organizer: 'yo',
    attendees: ['yo', 'ana'],
    joinUrl: 'https://meet.example.com/demo-delta'
  },
  {
    id: 'g-4',
    title: 'Planeación del sprint 25',
    dayOffset: 1,
    hour: 10,
    durationMinutes: 90,
    organizer: 'carla',
    attendees: ['yo', 'ana', 'bruno', 'carla'],
    location: 'Sala 2'
  },
  {
    id: 'g-5',
    title: 'Comité técnico',
    dayOffset: 3,
    hour: 9,
    durationMinutes: 60,
    organizer: 'yo',
    attendees: ['yo', 'diego', 'elena'],
    joinUrl: 'https://meet.example.com/comite'
  },
  {
    id: 'g-6',
    title: 'Retro del sprint 24',
    dayOffset: 4,
    hour: 17,
    durationMinutes: 45,
    organizer: 'carla',
    attendees: ['yo', 'ana', 'bruno', 'carla', 'diego', 'elena'],
    joinUrl: 'https://meet.example.com/retro-24'
  },
  {
    id: 'g-7',
    title: 'Seguimiento comercial Itech',
    dayOffset: -1,
    hour: 12,
    durationMinutes: 30,
    organizer: 'yo',
    attendees: ['yo'],
    joinUrl: 'https://meet.example.com/comercial-itech'
  }
];

/** Juntas de la cuenta personal. Sirven para ver los empalmes entre cuentas. */
const PERSONAL_SEEDS: MeetingSeed[] = [
  {
    id: 'm-1',
    title: 'Asesoría contable',
    dayOffset: 0,
    hour: 11,
    minute: 30,
    durationMinutes: 45,
    attendees: ['yo'],
    joinUrl: 'https://teams.example.com/asesoria'
  },
  {
    id: 'm-2',
    title: 'Junta de la asociación',
    dayOffset: 2,
    hour: 19,
    durationMinutes: 60,
    status: 'tentativa',
    attendees: ['yo'],
    location: 'Oficina centro'
  },
  {
    id: 'm-3',
    title: 'Entrevista candidato backend',
    dayOffset: 1,
    hour: 10,
    minute: 30,
    durationMinutes: 60,
    attendees: ['yo', 'bruno'],
    joinUrl: 'https://teams.example.com/entrevista'
  },
  {
    id: 'm-4',
    title: 'Cita médica',
    dayOffset: 5,
    hour: 8,
    durationMinutes: 60,
    attendees: ['yo'],
    location: 'Clínica'
  }
];

function toMeeting(seed: MeetingSeed, accountId: string, now: Date): Meeting {
  const start = atTime(
    addDays(now, seed.dayOffset),
    seed.hour,
    seed.minute ?? 0
  );
  const people = (keys: (keyof typeof DEMO_PEOPLE)[]): Person[] =>
    keys.map((k) => DEMO_PEOPLE[k]);
  return {
    id: `${accountId}-${seed.id}`,
    title: seed.title,
    start: start.toISOString(),
    end: addMinutes(start, seed.durationMinutes).toISOString(),
    allDay: false,
    accountId,
    status: seed.status ?? 'confirmada',
    organizer: seed.organizer ? DEMO_PEOPLE[seed.organizer] : undefined,
    attendees: people(seed.attendees),
    location: seed.location,
    joinUrl: seed.joinUrl,
    notes: seed.notes
  };
}

export function demoWorkMeetings(
  accountId: string,
  now = new Date()
): Meeting[] {
  return TRABAJO_SEEDS.map((seed) => toMeeting(seed, accountId, now));
}

export function demoPersonalMeetings(
  accountId: string,
  now = new Date()
): Meeting[] {
  return PERSONAL_SEEDS.map((seed) => toMeeting(seed, accountId, now));
}
