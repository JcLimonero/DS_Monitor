import { IconName } from '../../ui/icon.component';

/** Una pantalla del carrusel. */
export interface Diapositiva {
  id:
    | 'resumen'
    | 'pendientes'
    | 'agenda'
    | 'plataformas'
    | 'despliegues'
    | 'embudo'
    | 'licencias'
    | 'equipo';
  titulo: string;
  /** Etiqueta del indicador del pie, donde no cabe el titulo completo. */
  corto: string;
  icono: IconName;
}

/**
 * El recorrido del monitor, en el orden en que se ve.
 *
 * Arranca con el resumen para que quien pase de reojo se lleve las cifras, y
 * cierra con el equipo, que es lo que mas se comenta parado enfrente.
 */
export const DIAPOSITIVAS: Diapositiva[] = [
  {
    id: 'resumen',
    titulo: 'Resumen del día',
    corto: 'Resumen',
    icono: 'panel'
  },
  {
    id: 'pendientes',
    titulo: 'Pendientes críticos',
    corto: 'Pendientes',
    icono: 'tareas'
  },
  { id: 'agenda', titulo: 'Agenda', corto: 'Agenda', icono: 'agenda' },
  {
    id: 'plataformas',
    titulo: 'Plataformas',
    corto: 'Plataformas',
    icono: 'monitoreo'
  },
  {
    id: 'despliegues',
    titulo: 'Despliegues',
    corto: 'Despliegues',
    icono: 'despliegue'
  },
  { id: 'embudo', titulo: 'Embudo comercial', corto: 'Embudo', icono: 'crm' },
  {
    id: 'licencias',
    titulo: 'Licencias y consumo',
    corto: 'Licencias',
    icono: 'licencia'
  },
  { id: 'equipo', titulo: 'Equipo', corto: 'Equipo', icono: 'equipo' }
];

/** Segundos por pantalla si nadie dice otra cosa. */
export const SEGUNDOS_POR_DEFECTO = 20;

export const SEGUNDOS_MINIMO = 5;
export const SEGUNDOS_MAXIMO = 300;
