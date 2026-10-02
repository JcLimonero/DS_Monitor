import { Account } from './common.model';

/**
 * Los ajustes del portal que se comparten desde el puente: apagar una fuente,
 * pasar una conexión a datos reales, y agregar o quitar buzones. Antes eran
 * por navegador. `actualizadoEn` vacío es "nadie ha guardado nada todavía".
 */
export interface AjustesPortal {
  /** Encendido/apagado explícito por cuenta (id → enabled), sobre el de fábrica. */
  cuentasApagadas: Record<string, boolean>;
  /** Modo por conexión (id de conexión → gateway o demo). */
  modos: Record<string, 'gateway' | 'demo'>;
  buzonesAgregados: Account[];
  /** Buzones de fábrica que se quitaron desde la aplicación. */
  buzonesQuitados: string[];
  actualizadoEn: string;
  actualizadoPor: string;
}
