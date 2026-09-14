import { IconName } from '../../ui/icon.component';

/** Una pantalla del carrusel. */
export interface Diapositiva {
  id: 'resumen' | 'pendientes' | 'agenda' | 'plataformas' | 'embudo' | 'equipo';
  titulo: string;
  icono: IconName;
}

/**
 * El recorrido del monitor, en el orden en que se ve.
 *
 * Arranca con el resumen para que quien pase de reojo se lleve las cifras, y
 * cierra con el equipo, que es lo que mas se comenta parado enfrente.
 */
export const DIAPOSITIVAS: Diapositiva[] = [
  { id: 'resumen', titulo: 'Resumen del día', icono: 'panel' },
  { id: 'pendientes', titulo: 'Pendientes críticos', icono: 'tareas' },
  { id: 'agenda', titulo: 'Agenda', icono: 'agenda' },
  { id: 'plataformas', titulo: 'Plataformas', icono: 'monitoreo' },
  { id: 'embudo', titulo: 'Embudo comercial', icono: 'crm' },
  { id: 'equipo', titulo: 'Equipo', icono: 'equipo' }
];

/** Segundos por pantalla si nadie dice otra cosa. */
export const SEGUNDOS_POR_DEFECTO = 20;

export const SEGUNDOS_MINIMO = 5;
export const SEGUNDOS_MAXIMO = 300;
