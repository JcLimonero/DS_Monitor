import { LicenseMember, LicenseUsage } from '../../models';
import { addDays, startOfDay } from '../../util/date.util';
import { DEMO_PEOPLE } from './demo-people';

/**
 * Consumo de licencias de demostración.
 *
 * Las cifras son inventadas pero con la forma real de cada proveedor: Claude
 * cobra por tokens sin tope contratado, Cursor por asiento con gasto medido,
 * Figma por asiento sin API de facturación, y Vercel por consumo de la
 * plataforma. Ver portal/README.md para qué expone cada API de verdad.
 */

interface MiembroSeed {
  persona: keyof typeof DEMO_PEOPLE;
  used: number;
  active?: boolean;
}

function miembros(seeds: MiembroSeed[]): LicenseMember[] {
  return seeds.map((seed) => ({
    person: DEMO_PEOPLE[seed.persona],
    used: seed.used,
    active: seed.active ?? true
  }));
}

export function demoLicenses(
  accountId: string,
  now = new Date()
): LicenseUsage[] {
  // El periodo corre del día 1 del mes en curso al día 1 del siguiente.
  const inicioMes = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const finMes = startOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const periodo = {
    periodStart: inicioMes.toISOString(),
    periodEnd: finMes.toISOString()
  };

  return [
    {
      id: 'claude-api',
      provider: 'anthropic',
      product: 'Claude API',
      plan: 'Organización',
      unit: 'tokens',
      used: 148_320_000,
      // Sin tope: el consumo de la API se cobra por token, no por cupo.
      limit: undefined,
      ...periodo,
      cost: 1_284.5,
      currency: 'USD',
      manual: false,
      members: [],
      accountId,
      url: 'https://platform.claude.com/cost',
      updatedAt: now.toISOString()
    },
    {
      id: 'claude-code',
      provider: 'anthropic',
      product: 'Claude Code',
      plan: 'Equipo · 6 asientos',
      unit: 'asientos',
      used: 5,
      limit: 6,
      ...periodo,
      cost: 900,
      currency: 'USD',
      renewsAt: addDays(startOfDay(now), 12).toISOString(),
      manual: false,
      members: miembros([
        { persona: 'yo', used: 1 },
        { persona: 'ana', used: 1 },
        { persona: 'bruno', used: 1 },
        { persona: 'carla', used: 1 },
        { persona: 'diego', used: 1 },
        { persona: 'elena', used: 0, active: false }
      ]),
      accountId,
      url: 'https://platform.claude.com/usage',
      updatedAt: now.toISOString()
    },
    {
      id: 'cursor-business',
      provider: 'cursor',
      product: 'Cursor Business',
      plan: '5 asientos',
      unit: 'asientos',
      used: 5,
      limit: 5,
      ...periodo,
      cost: 200,
      currency: 'USD',
      renewsAt: addDays(startOfDay(now), 4).toISOString(),
      manual: false,
      members: miembros([
        { persona: 'ana', used: 1 },
        { persona: 'bruno', used: 1 },
        { persona: 'carla', used: 1 },
        { persona: 'diego', used: 1 },
        { persona: 'yo', used: 1 }
      ]),
      accountId,
      url: 'https://cursor.com/dashboard',
      updatedAt: now.toISOString()
    },
    {
      id: 'cursor-solicitudes',
      provider: 'cursor',
      product: 'Cursor · solicitudes del mes',
      unit: 'solicitudes',
      used: 4_180,
      limit: 5_000,
      ...periodo,
      manual: false,
      members: miembros([
        { persona: 'ana', used: 1520 },
        { persona: 'bruno', used: 1180 },
        { persona: 'diego', used: 760 },
        { persona: 'carla', used: 470 },
        { persona: 'yo', used: 250 }
      ]),
      accountId,
      url: 'https://cursor.com/dashboard',
      updatedAt: now.toISOString()
    },
    {
      id: 'figma-organizacion',
      provider: 'figma',
      product: 'Figma Organization',
      plan: 'Asientos de edición',
      unit: 'asientos',
      used: 3,
      limit: 4,
      ...periodo,
      cost: 180,
      currency: 'USD',
      renewsAt: addDays(startOfDay(now), 38).toISOString(),
      // La API de Figma no publica facturación ni asientos contratados: el tope
      // y el costo se capturan a mano. Ver portal/README.md.
      manual: true,
      members: miembros([
        { persona: 'ana', used: 1 },
        { persona: 'carla', used: 1 },
        { persona: 'yo', used: 1, active: false }
      ]),
      accountId,
      url: 'https://www.figma.com/files',
      updatedAt: addDays(now, -2).toISOString()
    },
    {
      id: 'vercel-pro',
      provider: 'vercel',
      product: 'Vercel Pro',
      plan: 'Equipo',
      unit: 'dinero',
      used: 62,
      limit: 80,
      ...periodo,
      cost: 62,
      currency: 'USD',
      renewsAt: addDays(startOfDay(now), 19).toISOString(),
      manual: false,
      members: [],
      accountId,
      url: 'https://vercel.com/dashboard/usage',
      updatedAt: now.toISOString()
    }
  ];
}
