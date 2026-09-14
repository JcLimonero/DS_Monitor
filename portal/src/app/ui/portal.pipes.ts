import { Pipe, PipeTransform } from '@angular/core';
import { formatDay, formatRelative, formatTime } from '../core/util/date.util';

/** "hace 2 horas", "en 3 días". Vacío si no hay fecha. */
@Pipe({ name: 'relativo' })
export class RelativePipe implements PipeTransform {
  transform(iso: string | undefined): string {
    return formatRelative(iso);
  }
}

/** "mie, 12 mar" */
@Pipe({ name: 'dia' })
export class DayPipe implements PipeTransform {
  transform(iso: string | undefined): string {
    return iso ? formatDay(iso) : '';
  }
}

/** "09:30" */
@Pipe({ name: 'hora' })
export class TimePipe implements PipeTransform {
  transform(iso: string | undefined): string {
    return iso ? formatTime(iso) : '';
  }
}

/**
 * Importes en formato corto: "$1.2 M" en vez de "$1,250,000".
 *
 * En el embudo se comparan columnas de un vistazo, y ahí el número completo
 * estorba más de lo que informa. El símbolo se pone a mano porque el formato
 * compacto de moneda lo coloca de un lado o del otro según el motor, y no
 * queremos que la misma cifra se lea distinta en un navegador que en otro.
 */
const COMPACT = new Intl.NumberFormat('es-MX', {
  notation: 'compact',
  maximumFractionDigits: 1
});

const SYMBOLS: Record<string, string> = {
  MXN: '$',
  USD: 'US$',
  EUR: '€'
};

@Pipe({ name: 'moneda' })
export class MoneyPipe implements PipeTransform {
  transform(amount: number | undefined, currency = 'MXN'): string {
    if (amount === undefined || Number.isNaN(amount)) {
      return '-';
    }
    const symbol = SYMBOLS[currency] ?? `${currency} `;
    return `${symbol}${COMPACT.format(amount)}`;
  }
}
