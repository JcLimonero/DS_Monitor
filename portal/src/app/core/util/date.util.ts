/** Utilidades de fecha. Todo el portal habla ISO y formatea en es-MX. */

export const MS_HOUR = 3_600_000;
export const MS_DAY = 24 * MS_HOUR;

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_DAY);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Mismo día que `date` pero a la hora indicada. */
export function atTime(date: Date, hours: number, minutes = 0): Date {
  const copy = startOfDay(date);
  copy.setHours(hours, minutes, 0, 0);
  return copy;
}

/** Lunes de la semana de `date`. La semana laboral aquí empieza en lunes. */
export function startOfWeek(date: Date): Date {
  const copy = startOfDay(date);
  // getDay() da 0 para domingo, así que el domingo retrocede seis días.
  const offset = (copy.getDay() + 6) % 7;
  return addDays(copy, -offset);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Reloj de 24 horas: en una agenda apretada el "a. m." solo roba ancho.
const timeFormat = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});
const dayFormat = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short',
  day: 'numeric',
  month: 'short'
});
const longDayFormat = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatDay(iso: string | Date): string {
  return dayFormat.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function formatLongDay(value: string | Date): string {
  return longDayFormat.format(
    typeof value === 'string' ? new Date(value) : value
  );
}

/** "hace 2 h", "en 3 días". Devuelve cadena vacía si no hay fecha. */
export function formatRelative(
  iso: string | undefined,
  now = new Date()
): string {
  if (!iso) {
    return '';
  }
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });
  if (abs < MS_HOUR) {
    return rtf.format(Math.round(diff / 60_000), 'minute');
  }
  if (abs < MS_DAY) {
    return rtf.format(Math.round(diff / MS_HOUR), 'hour');
  }
  return rtf.format(Math.round(diff / MS_DAY), 'day');
}

/** Cubeta a la que cae una fecha compromiso, para agrupar los pendientes. */
export type DueBucket =
  'vencido' | 'hoy' | 'manana' | 'semana' | 'despues' | 'sin_fecha';

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  vencido: 'Vencidos',
  hoy: 'Hoy',
  manana: 'Mañana',
  semana: 'Esta semana',
  despues: 'Más adelante',
  sin_fecha: 'Sin fecha'
};

/** Orden en que se muestran las cubetas: lo urgente primero. */
export const DUE_BUCKET_ORDER: DueBucket[] = [
  'vencido',
  'hoy',
  'manana',
  'semana',
  'despues',
  'sin_fecha'
];

export function dueBucket(
  iso: string | undefined,
  now = new Date()
): DueBucket {
  if (!iso) {
    return 'sin_fecha';
  }
  const due = new Date(iso);
  if (due.getTime() < now.getTime() && !isSameDay(due, now)) {
    return 'vencido';
  }
  if (isSameDay(due, now)) {
    return 'hoy';
  }
  if (isSameDay(due, addDays(now, 1))) {
    return 'manana';
  }
  // El resto de la semana en curso, contando desde el lunes.
  if (due.getTime() <= endOfDay(addDays(startOfWeek(now), 6)).getTime()) {
    return 'semana';
  }
  return 'despues';
}

/** True si la fecha ya pasó y no es hoy. */
export function isOverdue(iso: string | undefined, now = new Date()): boolean {
  return dueBucket(iso, now) === 'vencido';
}
