import { AccountColor } from '../core/models';

/**
 * Clases por color de cuenta.
 *
 * Van escritas completas a propósito: Tailwind revisa el código fuente como
 * texto, y una clase armada por concatenación (`bg-${color}-100`) no aparece en
 * el CSS final.
 */
export const ACCOUNT_CHIP_CLASS: Record<AccountColor, string> = {
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  violet:
    'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  emerald:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  slate: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300'
};

export const ACCOUNT_BAR_CLASS: Record<AccountColor, string> = {
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  slate: 'bg-slate-400'
};
