import { Person } from '../../models';

/**
 * Personas de demostración. Nombres y correos inventados a propósito: este
 * repositorio es público y aquí no van datos de nadie real.
 */
export const DEMO_PEOPLE = {
  yo: {
    id: 'yo',
    name: 'Juan Carlos',
    email: 'yo@example.com',
    role: 'Dirección técnica'
  },
  ana: {
    id: 'ana',
    name: 'Ana Robles',
    email: 'ana@example.com',
    role: 'Frontend'
  },
  bruno: {
    id: 'bruno',
    name: 'Bruno Casares',
    email: 'bruno@example.com',
    role: 'Backend'
  },
  carla: {
    id: 'carla',
    name: 'Carla Mejia',
    email: 'carla@example.com',
    role: 'QA'
  },
  diego: {
    id: 'diego',
    name: 'Diego Fuentes',
    email: 'diego@example.com',
    role: 'Infraestructura'
  },
  elena: {
    id: 'elena',
    name: 'Elena Paredes',
    email: 'elena@example.com',
    role: 'Datos'
  }
} satisfies Record<string, Person>;

/** El usuario del portal. Sirve para separar "mis pendientes" de los del equipo. */
export const CURRENT_USER: Person = DEMO_PEOPLE.yo;

export const DEMO_TEAM: Person[] = [
  DEMO_PEOPLE.ana,
  DEMO_PEOPLE.bruno,
  DEMO_PEOPLE.carla,
  DEMO_PEOPLE.diego,
  DEMO_PEOPLE.elena
];
