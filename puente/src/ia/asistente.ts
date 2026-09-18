import type { ConfiguracionIa } from '../config/entorno.js';
import type { Alerta } from './alertas.js';
import { CONTEXTO_EMPRESAS, preguntar } from './modelo.js';
import { contextoDelDia } from './resumen.js';
import { abiertos, type Tablero } from './tablero.js';

/**
 * La ventana de la IA: se le pregunta lo que sea sobre el tablero ("¿que
 * vence esta semana de Dealer?", "¿que le asigne a Matias?", "redactame un
 * mensaje para Vanguardia con los tres temas") y responde con lo que hay.
 * Va con el contexto del dia mas la lista de abiertos (recortada) y los
 * ultimos turnos de la conversacion; sin memoria entre sesiones.
 */
export interface Turno {
  rol: 'usuario' | 'asistente';
  texto: string;
}

export async function responderAsistente(
  config: ConfiguracionIa,
  tablero: Tablero,
  alertas: Alerta[],
  conversacion: Turno[],
  ahora = new Date()
): Promise<string> {
  const contexto = contextoDelDia(tablero, alertas, ahora);
  const pendientes = abiertos(tablero.pendientes)
    .slice(0, 120)
    .map((t) =>
      [
        t.title,
        t.company,
        t.project,
        t.assignee?.name ? `resp. ${t.assignee.name}` : 'sin asignar',
        t.priority,
        t.dueDate ? `vence ${t.dueDate.slice(0, 10)}` : 'sin fecha',
        t.status
      ]
        .filter((x) => x)
        .join(' · ')
    );
  const juntas = tablero.juntas
    .filter((j) => Date.parse(j.end) >= ahora.getTime() - 86_400_000)
    .slice(0, 40)
    .map(
      (j) =>
        `${j.start.slice(0, 16)} ${j.title}${j.location ? ` (${j.location})` : ''}`
    );
  const equipo = tablero.equipo.map(
    (p) => `${p.name}${p.role ? ` (${p.role})` : ''}`
  );
  const previos = conversacion.slice(-8, -1);
  const ultimo = conversacion[conversacion.length - 1];
  if (!ultimo || ultimo.rol !== 'usuario') {
    return '';
  }
  return preguntar(config, {
    uso: 'asistente',
    sistema: `${CONTEXTO_EMPRESAS}\nEres el asistente del tablero DS Monitor. Respondes a Carlos (director) sobre lo que hay en el tablero: pendientes, juntas, equipo, licencias, dominios, sitios y despliegues. Usa SOLO los datos que te doy; si algo no está, dilo. Sé breve y concreto (listas cortas, fechas y nombres). Si te piden redactar (un correo, un mensaje, un resumen para alguien), redáctalo listo para copiar. No inventes pendientes ni fechas.\n\nHoy: ${JSON.stringify(contexto)}\n\nPendientes abiertos:\n${pendientes.join('\\n')}\n\nJuntas próximas:\n${juntas.join('\\n')}\n\nEquipo: ${equipo.join(', ')}`,
    usuario:
      (previos.length
        ? `Conversación previa:\n${previos.map((t) => `${t.rol === 'usuario' ? 'Carlos' : 'Asistente'}: ${t.texto.slice(0, 500)}`).join('\n')}\n\n`
        : '') + `Carlos: ${ultimo.texto.slice(0, 2000)}`,
    maxTokens: 1200
  });
}
