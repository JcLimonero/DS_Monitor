import {
  CrmActivity,
  CrmActivityType,
  CrmOpportunity,
  CrmStage
} from '../../models';
import { addDays, atTime } from '../../util/date.util';
import { DEMO_PEOPLE } from './demo-people';

interface OpportunitySeed {
  id: string;
  name: string;
  partner: string;
  stage: CrmStage;
  amount: number;
  probability: number;
  /** Días desde hoy para el cierre esperado. `null` si no tiene fecha. */
  closeInDays: number | null;
  salesperson: keyof typeof DEMO_PEOPLE;
  updatedDaysAgo: number;
}

// Clientes inventados: el repositorio es público.
const OPPORTUNITY_SEEDS: OpportunitySeed[] = [
  {
    id: 'opp-1',
    name: 'Licenciamiento y soporte anual',
    partner: 'Grupo Delta',
    stage: 'propuesta',
    amount: 480000,
    probability: 60,
    closeInDays: 12,
    salesperson: 'yo',
    updatedDaysAgo: 0
  },
  {
    id: 'opp-2',
    name: 'Integración de inventario con Salesforce',
    partner: 'Automotriz del Norte',
    stage: 'negociacion',
    amount: 1250000,
    probability: 75,
    closeInDays: 6,
    salesperson: 'yo',
    updatedDaysAgo: 1
  },
  {
    id: 'opp-3',
    name: 'Renovación de plataforma',
    partner: 'Servicios Peninsular',
    stage: 'calificado',
    amount: 320000,
    probability: 40,
    closeInDays: 28,
    salesperson: 'elena',
    updatedDaysAgo: 4
  },
  {
    id: 'opp-4',
    name: 'Portal de facturación a la medida',
    partner: 'Distribuidora Bajío',
    stage: 'nuevo',
    amount: 210000,
    probability: 15,
    closeInDays: 45,
    salesperson: 'yo',
    updatedDaysAgo: 2
  },
  {
    id: 'opp-5',
    name: 'Tablero de indicadores de postventa',
    partner: 'Motores del Golfo',
    stage: 'propuesta',
    amount: 175000,
    probability: 55,
    closeInDays: 20,
    salesperson: 'elena',
    updatedDaysAgo: 7
  },
  {
    id: 'opp-6',
    name: 'Migración de la base histórica',
    partner: 'Comercial Altiplano',
    stage: 'ganado',
    amount: 640000,
    probability: 100,
    closeInDays: -3,
    salesperson: 'yo',
    updatedDaysAgo: 3
  },
  {
    id: 'opp-7',
    name: 'Modulo de refacciones',
    partner: 'Refacciones Centro',
    stage: 'perdido',
    amount: 95000,
    probability: 0,
    closeInDays: -9,
    salesperson: 'elena',
    updatedDaysAgo: 9
  },
  {
    id: 'opp-8',
    name: 'Soporte extendido 24/7',
    partner: 'Grupo Delta',
    stage: 'calificado',
    amount: 260000,
    probability: 35,
    closeInDays: null,
    salesperson: 'yo',
    updatedDaysAgo: 18
  }
];

interface ActivitySeed {
  id: string;
  summary: string;
  type: CrmActivityType;
  dueInDays: number;
  dueHour: number;
  responsible: keyof typeof DEMO_PEOPLE;
  opportunityId?: string;
}

const ACTIVITY_SEEDS: ActivitySeed[] = [
  {
    id: 'act-1',
    summary: 'Mandar el desglose de licencias',
    type: 'correo',
    dueInDays: 0,
    dueHour: 15,
    responsible: 'yo',
    opportunityId: 'opp-1'
  },
  {
    id: 'act-2',
    summary: 'Llamada de seguimiento a compras',
    type: 'llamada',
    dueInDays: -1,
    dueHour: 9,
    responsible: 'yo',
    opportunityId: 'opp-2'
  },
  {
    id: 'act-3',
    summary: 'Agendar demo técnica',
    type: 'reunion',
    dueInDays: 2,
    dueHour: 11,
    responsible: 'elena',
    opportunityId: 'opp-3'
  },
  {
    id: 'act-4',
    summary: 'Preparar contrato de renovación',
    type: 'tarea',
    dueInDays: 4,
    dueHour: 10,
    responsible: 'yo',
    opportunityId: 'opp-5'
  },
  {
    id: 'act-5',
    summary: 'Confirmar datos de facturación',
    type: 'correo',
    dueInDays: 1,
    dueHour: 13,
    responsible: 'yo',
    opportunityId: 'opp-6'
  },
  {
    id: 'act-6',
    summary: 'Primer contacto con el área de sistemas',
    type: 'llamada',
    dueInDays: 3,
    dueHour: 16,
    responsible: 'elena',
    opportunityId: 'opp-4'
  }
];

export function demoOpportunities(
  accountId: string,
  now = new Date()
): CrmOpportunity[] {
  return OPPORTUNITY_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    partner: seed.partner,
    stage: seed.stage,
    amount: seed.amount,
    currency: 'MXN',
    probability: seed.probability,
    expectedClose:
      seed.closeInDays === null
        ? undefined
        : atTime(addDays(now, seed.closeInDays), 12).toISOString(),
    salesperson: DEMO_PEOPLE[seed.salesperson],
    accountId,
    url: `https://crm.example.com/odoo/crm/${seed.id}`,
    updatedAt: addDays(now, -seed.updatedDaysAgo).toISOString()
  }));
}

export function demoActivities(
  accountId: string,
  now = new Date()
): CrmActivity[] {
  const byId = new Map(OPPORTUNITY_SEEDS.map((seed) => [seed.id, seed]));
  return ACTIVITY_SEEDS.map((seed) => ({
    id: seed.id,
    summary: seed.summary,
    type: seed.type,
    dueDate: atTime(addDays(now, seed.dueInDays), seed.dueHour).toISOString(),
    responsible: DEMO_PEOPLE[seed.responsible],
    opportunityId: seed.opportunityId,
    opportunityName: seed.opportunityId
      ? byId.get(seed.opportunityId)?.name
      : undefined,
    accountId,
    url: `https://crm.example.com/odoo/actividad/${seed.id}`
  }));
}
