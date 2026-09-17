import type { Dominio } from '../datos/dominios.js';
import { homologarJuntas, juntasSinHomologar } from '../nucleo/juntas.js';
import type {
  Deployment,
  LicenseUsage,
  Meeting,
  MonitorTarget,
  Person,
  RepoStatus,
  TaskItem
} from '../nucleo/contrato.js';

/**
 * El tablero completo, armado del lado del servidor.
 *
 * El portal junta las fuentes en el navegador; aqui hace falta lo mismo pero
 * sin navegador: el resumen del dia, el correo semanal del equipo y las
 * alertas corren en el puente, a su hora. Cada fuente se pide por separado y
 * la que falle no tumba a las demas: se anota en `errores` y el tablero sale
 * con lo que si hubo.
 */
export interface Tablero {
  pendientes: TaskItem[];
  /** Ya homologadas: la misma junta en dos cuentas sale una vez. */
  juntas: Meeting[];
  /** Juntas que estan en una cuenta y faltan en otra. */
  juntasSinHomologar: { junta: Meeting; faltaEn: string[] }[];
  licencias: LicenseUsage[];
  dominios: Dominio[];
  monitoreo: MonitorTarget[];
  despliegues: Deployment[];
  repos: RepoStatus[];
  equipo: Person[];
  errores: string[];
  armadoEn: string;
}

/** Como se llega a cada fuente; las funciones las da `rutas.ts`. */
export interface Fuentes {
  pendientes: () => Promise<TaskItem[]>;
  juntas: () => Promise<Meeting[]>;
  licencias: () => Promise<LicenseUsage[]>;
  dominios: () => Dominio[];
  monitoreo: () => Promise<MonitorTarget[]>;
  despliegues: () => Promise<Deployment[]>;
  repos: () => Promise<RepoStatus[]>;
  equipo: () => Promise<Person[]>;
}

export async function armarTablero(
  fuentes: Fuentes,
  ahora = new Date()
): Promise<Tablero> {
  const errores: string[] = [];
  const con = async <T>(nombre: string, f: () => Promise<T> | T, vacio: T) => {
    try {
      return await f();
    } catch (error) {
      errores.push(
        `${nombre}: ${error instanceof Error ? error.message : String(error)}`
      );
      return vacio;
    }
  };
  const [
    pendientes,
    juntasCrudas,
    licencias,
    dominios,
    monitoreo,
    despliegues,
    repos,
    equipo
  ] = await Promise.all([
    con('pendientes', fuentes.pendientes, [] as TaskItem[]),
    con('juntas', fuentes.juntas, [] as Meeting[]),
    con('licencias', fuentes.licencias, [] as LicenseUsage[]),
    con('dominios', fuentes.dominios, [] as Dominio[]),
    con('monitoreo', fuentes.monitoreo, [] as MonitorTarget[]),
    con('despliegues', fuentes.despliegues, [] as Deployment[]),
    con('repos', fuentes.repos, [] as RepoStatus[]),
    con('equipo', fuentes.equipo, [] as Person[])
  ]);
  const juntas = homologarJuntas(juntasCrudas);
  const cuentas = [...new Set(juntasCrudas.map((j) => j.accountId))];
  return {
    pendientes,
    juntas,
    juntasSinHomologar: juntasSinHomologar(juntas, cuentas, ahora),
    licencias,
    dominios,
    monitoreo,
    despliegues,
    repos,
    equipo,
    errores,
    armadoEn: ahora.toISOString()
  };
}

const DIA_MS = 86_400_000;

/** Fecha local (America/Mexico_City) como YYYY-MM-DD. */
export function diaLocal(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

export function diasHasta(iso: string, ahora: Date): number {
  return Math.ceil((Date.parse(iso) - ahora.getTime()) / DIA_MS);
}

/** Lo abierto: pendientes que no estan hechos. */
export function abiertos(pendientes: TaskItem[]): TaskItem[] {
  return pendientes.filter((t) => t.status !== 'hecho');
}

export function vencidos(pendientes: TaskItem[], ahora: Date): TaskItem[] {
  return abiertos(pendientes).filter(
    (t) => t.dueDate && Date.parse(t.dueDate) < ahora.getTime()
  );
}

export function paraHoy(pendientes: TaskItem[], ahora: Date): TaskItem[] {
  const hoy = diaLocal(ahora);
  return abiertos(pendientes).filter(
    (t) => t.dueDate && diaLocal(t.dueDate) === hoy
  );
}

export function juntasDelDia(juntas: Meeting[], ahora: Date): Meeting[] {
  const hoy = diaLocal(ahora);
  return juntas
    .filter((j) => j.status !== 'cancelada' && diaLocal(j.start) === hoy)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Juntas entre dos instantes, sin canceladas, en orden. */
export function juntasEntre(
  juntas: Meeting[],
  desde: Date,
  hasta: Date
): Meeting[] {
  return juntas
    .filter(
      (j) =>
        j.status !== 'cancelada' &&
        Date.parse(j.start) >= desde.getTime() &&
        Date.parse(j.start) < hasta.getTime()
    )
    .sort((a, b) => a.start.localeCompare(b.start));
}
