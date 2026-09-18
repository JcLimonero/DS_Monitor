/**
 * Cuánto falta para una fecha y de qué color pintarla. La misma regla en
 * todas las tarjetas: vencido y hoy en rojo, dos días en naranja, la semana
 * en ámbar, y lo demás en verde.
 */
export type TonoPlazo = 'vencido' | 'hoy' | 'urgente' | 'pronto' | 'holgado';

export function diasRestantes(iso: string, ahora = new Date()): number {
  const hoy = new Date(ahora);
  hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(iso);
  fecha.setHours(0, 0, 0, 0);
  return Math.round((fecha.getTime() - hoy.getTime()) / 86_400_000);
}

export function tonoPlazo(iso: string, ahora = new Date()): TonoPlazo {
  const dias = diasRestantes(iso, ahora);
  if (dias < 0) {
    return 'vencido';
  }
  if (dias === 0) {
    return 'hoy';
  }
  if (dias <= 2) {
    return 'urgente';
  }
  if (dias <= 7) {
    return 'pronto';
  }
  return 'holgado';
}

/** Clases de Tailwind para el texto según el tono. */
export const CLASE_PLAZO: Record<TonoPlazo, string> = {
  vencido: 'text-danger',
  hoy: 'text-danger',
  urgente: 'text-orange-600 dark:text-orange-400',
  pronto: 'text-amber-600 dark:text-amber-400',
  holgado: 'text-emerald-600 dark:text-emerald-400'
};

/** Clases para un punto de color. */
export const PUNTO_PLAZO: Record<TonoPlazo, string> = {
  vencido: 'bg-danger',
  hoy: 'bg-danger',
  urgente: 'bg-orange-500',
  pronto: 'bg-amber-500',
  holgado: 'bg-emerald-500'
};

export function textoPlazo(iso: string, ahora = new Date()): string {
  const dias = diasRestantes(iso, ahora);
  if (dias < 0) {
    return `vencido hace ${-dias === 1 ? '1 día' : `${-dias} días`}`;
  }
  if (dias === 0) {
    return 'hoy';
  }
  if (dias === 1) {
    return 'mañana';
  }
  return `en ${dias} días`;
}
