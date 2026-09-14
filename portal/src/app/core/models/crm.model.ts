import { Person } from './common.model';

/** Etapas del embudo de Odoo, en el orden en que se recorren. */
export type CrmStage =
  'nuevo' | 'calificado' | 'propuesta' | 'negociacion' | 'ganado' | 'perdido';

export const CRM_STAGE_ORDER: CrmStage[] = [
  'nuevo',
  'calificado',
  'propuesta',
  'negociacion',
  'ganado',
  'perdido'
];

export const CRM_STAGE_LABEL: Record<CrmStage, string> = {
  nuevo: 'Nuevo',
  calificado: 'Calificado',
  propuesta: 'Propuesta',
  negociacion: 'Negociación',
  ganado: 'Ganado',
  perdido: 'Perdido'
};

export type CrmActivityType = 'llamada' | 'correo' | 'reunion' | 'tarea';

export const CRM_ACTIVITY_LABEL: Record<CrmActivityType, string> = {
  llamada: 'Llamada',
  correo: 'Correo',
  reunion: 'Reunión',
  tarea: 'Tarea'
};

export interface CrmOpportunity {
  id: string;
  name: string;
  /** Cliente o prospecto, el res.partner de Odoo. */
  partner: string;
  stage: CrmStage;
  /** Importe esperado en la moneda del campo currency. */
  amount: number;
  currency: string;
  /** Probabilidad de cierre de 0 a 100. */
  probability: number;
  expectedClose?: string;
  salesperson?: Person;
  accountId: string;
  url?: string;
  updatedAt: string;
}

/** Actividad programada en Odoo (mail.activity): la lista de "que sigue". */
export interface CrmActivity {
  id: string;
  summary: string;
  type: CrmActivityType;
  dueDate: string;
  responsible?: Person;
  /** Oportunidad a la que cuelga la actividad, si cuelga de alguna. */
  opportunityId?: string;
  opportunityName?: string;
  accountId: string;
  url?: string;
}
