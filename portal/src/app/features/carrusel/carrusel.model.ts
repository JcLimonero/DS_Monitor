import { Signal } from '@angular/core';
import { IconName } from '../../ui/icon.component';

/**
 * Lo que una diapositiva le dice al carrusel: si no tiene nada que enseñar
 * (`vacia`), el avance automatico la salta. Si todas las pantallas estan
 * vacias, se queda el tiempo corto para no ciclar. Si alguien tiene un
 * dialogo abierto encima (`enDialogo`), el carrusel se queda quieto hasta
 * que lo cierre, sin tocar la pausa que maneja el usuario.
 */
export interface DiapositivaConContenido {
  readonly vacia: Signal<boolean>;
  readonly enDialogo?: Signal<boolean>;
}

/** Una pantalla del carrusel. */
export interface Diapositiva {
  id:
    | 'resumen'
    | 'pendientes'
    | 'agenda'
    | 'plataformas'
    | 'vps'
    | 'ejecuciones'
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
    titulo: 'Pendientes',
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
    id: 'vps',
    titulo: 'Servidores',
    corto: 'Servidores',
    icono: 'monitor'
  },
  {
    id: 'ejecuciones',
    titulo: 'Servicios: última corrida',
    corto: 'Servicios',
    icono: 'reloj'
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

/** Cuanto se queda una diapositiva que no tiene nada que enseñar. */
export const SEGUNDOS_VACIA = 5;
export const SEGUNDOS_MAXIMO = 300;
