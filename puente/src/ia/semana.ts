import type { ConfiguracionIa } from '../config/entorno.js';
import type { Meeting, Person, TaskItem } from '../nucleo/contrato.js';
import type { Anotaciones } from '../pendientes/anotaciones.js';
import { contextoEmpresas } from '../datos/empresas.js';
import { comoJson, enHorario, preguntar, texto1 } from './modelo.js';
import { abiertos, juntasEntre, vencidos, type Tablero } from './tablero.js';

/**
 * La semana de cada persona del equipo: sus pendientes, lo que se le vencio y
 * sus juntas de los proximos siete dias. Sale cada lunes por correo (EmailJS,
 * el mismo servicio del acceso) con un parrafo de apertura que redacta el
 * modelo; sin modelo el correo va igual, sin parrafo.
 */
export interface SemanaPersona {
  persona: Person;
  pendientes: TaskItem[];
  vencidos: TaskItem[];
  juntas: Meeting[];
  /** El parrafo de apertura, si hubo modelo. */
  apertura?: string;
}

const DIAS_ADELANTE = 7;

export function semanaDeCadaQuien(
  tablero: Tablero,
  anotaciones: Anotaciones,
  ahora = new Date()
): SemanaPersona[] {
  const hasta = new Date(ahora.getTime() + DIAS_ADELANTE * 86_400_000);
  const proximas = juntasEntre(tablero.juntas, ahora, hasta);
  const abiertas = abiertos(tablero.pendientes);
  const venc = new Set(vencidos(tablero.pendientes, ahora).map((t) => t.id));
  return tablero.equipo
    .map((persona): SemanaPersona => {
      const correo = persona.email?.toLowerCase();
      const mias = abiertas.filter((t) => {
        const a = anotaciones[t.id]?.asignado;
        return (
          a &&
          (a.id === persona.id || (correo && a.email?.toLowerCase() === correo))
        );
      });
      return {
        persona,
        pendientes: mias.filter((t) => !venc.has(t.id)),
        vencidos: mias.filter((t) => venc.has(t.id)),
        juntas: correo
          ? proximas.filter(
              (j) =>
                j.organizer?.email?.toLowerCase() === correo ||
                j.attendees.some((a) => a.email?.toLowerCase() === correo)
            )
          : []
      };
    })
    .filter(
      (s) =>
        s.persona.email &&
        (s.pendientes.length || s.vencidos.length || s.juntas.length)
    );
}

/** Un parrafo por persona, en una sola llamada. */
export async function redactarAperturas(
  config: ConfiguracionIa | undefined,
  semanas: SemanaPersona[]
): Promise<SemanaPersona[]> {
  if (!config || semanas.length === 0) {
    return semanas;
  }
  const texto = await preguntar(config, {
    uso: 'semana',
    sistema: `${contextoEmpresas()}\nEscribes el correo del lunes para cada persona del equipo. Te doy, por persona, sus pendientes, lo vencido y sus juntas de la semana. Para cada una escribe UN párrafo de apertura (2 o 3 frases, máx. 320 caracteres) que la salude por su nombre de pila, le diga en qué conviene concentrarse primero y por qué, y mencione lo vencido sin regañar. Responde SOLO JSON: {"personas":[{"id":"...","apertura":"..."}]}`,
    usuario: JSON.stringify(
      semanas.map((s) => ({
        id: s.persona.id,
        nombre: s.persona.name,
        pendientes: s.pendientes.slice(0, 15).map(cita),
        vencidos: s.vencidos.slice(0, 10).map(cita),
        juntas: s.juntas
          .slice(0, 10)
          .map((j) => `${enHorario(j.start)} ${j.title}`)
      }))
    ),
    json: true,
    maxTokens: 2500
  });
  const salida = comoJson<{ personas?: { id?: string; apertura?: unknown }[] }>(
    texto
  );
  const porId = new Map(
    (salida.personas ?? []).map((p) => [p.id, texto1(p.apertura)])
  );
  return semanas.map((s) => ({ ...s, apertura: porId.get(s.persona.id) }));
}

function cita(t: TaskItem): string {
  return `${t.title}${t.company ? ` (${t.company})` : ''}${t.dueDate ? `, vence ${enHorario(t.dueDate, false)}` : ''}, prioridad ${t.priority}`;
}

/** El correo en HTML, sencillo para que se vea igual en todos lados. */
export function correoDeSemana(s: SemanaPersona, urlPortal: string): string {
  const lista = (tareas: TaskItem[]) =>
    `<ul>${tareas
      .map(
        (t) =>
          `<li><strong>${escapar(t.title)}</strong>${t.company ? ` · ${escapar(t.company)}` : ''}${t.dueDate ? ` · vence ${enHorario(t.dueDate, false)}` : ''} · ${t.priority}</li>`
      )
      .join('')}</ul>`;
  return (
    `<p>Hola ${escapar(s.persona.name.split(' ')[0] ?? s.persona.name)},</p>` +
    (s.apertura ? `<p>${escapar(s.apertura)}</p>` : '') +
    (s.vencidos.length
      ? `<h3 style="color:#b42318">Vencidos (${s.vencidos.length})</h3>${lista(s.vencidos)}`
      : '') +
    (s.pendientes.length
      ? `<h3>Tus pendientes (${s.pendientes.length})</h3>${lista(s.pendientes)}`
      : '') +
    (s.juntas.length
      ? `<h3>Juntas de la semana (${s.juntas.length})</h3><ul>${s.juntas
          .map(
            (j) =>
              `<li>${enHorario(j.start)} · <strong>${escapar(j.title)}</strong>${j.joinUrl ? ` · <a href="${j.joinUrl}">entrar</a>` : ''}</li>`
          )
          .join('')}</ul>`
      : '') +
    `<p><a href="${urlPortal.includes('/mio/') ? urlPortal : `${urlPortal}/pendientes`}" style="display:inline-block;padding:10px 16px;background:#04202B;color:#fff;text-decoration:none;border-radius:6px">Ver mis pendientes, comentar o marcar como hecho</a></p>`
  );
}

function escapar(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
