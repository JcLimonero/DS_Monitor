import type { Ejecucion, EstadoEjecucion } from '../ingesta/ejecuciones.js';
import type { MonitorTarget, TaskItem } from './contrato.js';
import type { Tablero } from '../ia/tablero.js';
import {
  describirResumen,
  type ResumenAutoasignacion
} from '../pendientes/autoasignar.js';
import {
  abiertos,
  juntasDelDia,
  paraHoy,
  proximasEntregas,
  vencidos
} from '../ia/tablero.js';

/**
 * Los comandos del bot de Telegram: consultas cortas sin abrir el portal.
 * Aqui solo se arma el texto (HTML de Telegram); quien recibe el mensaje
 * decide que datos pasar.
 *
 *   /hoy         juntas de hoy, vencidos y lo que vence hoy
 *   /pendientes  lo abierto, lo urgente primero
 *   /servicios   la ultima corrida de cada servicio y los sitios caidos
 *   /autoasignar barrido: busca responsable a los pendientes que no tienen
 *   ?pregunta    la IA contesta con lo que hay en el tablero
 *   /ayuda       esta lista
 */

export type Comando =
  | { tipo: 'hoy' }
  | { tipo: 'pendientes' }
  | { tipo: 'servicios' }
  | { tipo: 'autoasignar' }
  | { tipo: 'ayuda' }
  | { tipo: 'pregunta'; texto: string }
  | undefined;

/** Que pidio el mensaje, o undefined si es un dictado normal. */
export function interpretarComando(texto: string): Comando {
  const limpio = texto.trim();
  const m = /^\/(\w+)(?:@\w+)?\s*(.*)$/s.exec(limpio);
  if (m) {
    const nombre = (m[1] as string).toLowerCase();
    const resto = (m[2] ?? '').trim();
    if (nombre === 'hoy') {
      return { tipo: 'hoy' };
    }
    if (nombre === 'pendientes' || nombre === 'pendiente') {
      return { tipo: 'pendientes' };
    }
    if (nombre === 'servicios' || nombre === 'ejecuciones') {
      return { tipo: 'servicios' };
    }
    if (nombre === 'autoasignar' || nombre === 'barrido') {
      return { tipo: 'autoasignar' };
    }
    if (nombre === 'ayuda' || nombre === 'help') {
      return { tipo: 'ayuda' };
    }
    if ((nombre === 'ia' || nombre === 'pregunta') && resto) {
      return { tipo: 'pregunta', texto: resto };
    }
    return undefined;
  }
  if (/^[?¿]/.test(limpio) && limpio.length > 2) {
    return { tipo: 'pregunta', texto: limpio.replace(/^[?¿]+\s*/, '') };
  }
  return undefined;
}

export const TEXTO_AYUDA =
  '<b>Qué puedo hacer</b>\n' +
  '• Escríbeme o dicta un pendiente y lo anoto.\n' +
  '• <code>/hoy</code> — juntas de hoy, vencidos y lo que vence hoy.\n' +
  '• <code>/pendientes</code> — lo abierto, lo urgente primero.\n' +
  '• <code>/servicios</code> — la última corrida de cada servicio y sitios caídos.\n' +
  '• <code>/autoasignar</code> — barrido: busca responsable a los pendientes de correo que no tienen.\n' +
  '• <code>?pregunta</code> — la IA contesta con lo que hay en el tablero.';

export function textoHoy(tablero: Tablero, ahora = new Date()): string {
  const juntas = juntasDelDia(tablero.juntas, ahora);
  const venc = vencidos(tablero.pendientes, ahora);
  const hoy = paraHoy(tablero.pendientes, ahora);
  const proximas = proximasEntregas(tablero.pendientes, ahora, 7);
  const lineas: string[] = [`<b>Hoy · ${fechaCorta(ahora)}</b>`];
  lineas.push(
    juntas.length === 0
      ? 'Sin juntas.'
      : `<b>Juntas</b>\n${juntas
          .map(
            (j) =>
              `• ${j.allDay ? 'todo el día' : hora(j.start)} ${escapar(j.title)}${j.location ? ` · ${escapar(j.location)}` : ''}`
          )
          .join('\n')}`
  );
  if (venc.length > 0) {
    lineas.push(`<b>Vencidos (${venc.length})</b>\n${lista(venc, 6)}`);
  }
  lineas.push(
    hoy.length === 0
      ? 'Nada vence hoy.'
      : `<b>Vence hoy (${hoy.length})</b>\n${lista(hoy, 8)}`
  );
  if (proximas.length > 0) {
    lineas.push(`Y ${proximas.length} más en la semana.`);
  }
  return lineas.join('\n\n');
}

export function textoPendientes(tablero: Tablero, ahora = new Date()): string {
  const peso = { urgente: 0, alta: 1, media: 2, baja: 3 } as const;
  const todos = abiertos(tablero.pendientes)
    .filter((t) => !t.personal)
    .sort((a, b) => {
      const va = a.dueDate ? Date.parse(a.dueDate) : Infinity;
      const vb = b.dueDate ? Date.parse(b.dueDate) : Infinity;
      const venA = va < ahora.getTime() ? 0 : 1;
      const venB = vb < ahora.getTime() ? 0 : 1;
      return venA - venB || peso[a.priority] - peso[b.priority] || va - vb;
    });
  if (todos.length === 0) {
    return 'No hay pendientes abiertos.';
  }
  const sinDueno = todos.filter((t) => !t.assignee).length;
  return (
    `<b>Pendientes abiertos: ${todos.length}</b>` +
    (sinDueno > 0 ? ` · ${sinDueno} sin responsable` : '') +
    `\n${lista(todos, 12, true)}` +
    (todos.length > 12 ? `\n… y ${todos.length - 12} más en el portal.` : '')
  );
}

/** El resultado del barrido de autoasignacion, con quien quedo cada uno. */
export function textoAutoasignacion(resumen: ResumenAutoasignacion): string {
  const lineas = [
    `<b>Autoasignación</b> · ${escapar(describirResumen(resumen))}`
  ];
  const renglones = (
    titulo: string,
    lista: ResumenAutoasignacion['asignadosPorRegla']
  ) => {
    if (lista.length > 0) {
      lineas.push(
        `<b>${titulo}</b>\n${lista
          .slice(0, 12)
          .map((p) => `• ${escapar(p.titulo)} → ${escapar(p.responsable)}`)
          .join(
            '\n'
          )}${lista.length > 12 ? `\n… y ${lista.length - 12} más.` : ''}`
      );
    }
  };
  renglones('Asignados por regla', resumen.asignadosPorRegla);
  renglones('Asignados por la IA', resumen.asignadosPorIa);
  renglones('Sugeridos (esperan decisión)', resumen.sugeridos);
  if (resumen.revisados === 0 && resumen.omitidos === 0) {
    lineas.push('No había pendientes de correo sin responsable que revisar.');
  } else if (resumen.omitidos > 0) {
    lineas.push(
      `Quedaron ${resumen.omitidos} sin revisar (sin IA o se acabaron las consultas); vuelve a mandar /autoasignar.`
    );
  }
  return lineas.join('\n\n');
}

export function textoServicios(
  ejecuciones: (Ejecucion & { estado: EstadoEjecucion })[],
  sitios: MonitorTarget[],
  ahora = new Date()
): string {
  const lineas: string[] = [];
  const caidos = sitios.filter((s) => s.status === 'caido');
  if (caidos.length > 0) {
    lineas.push(
      `<b>Sitios caídos (${caidos.length})</b>\n${caidos
        .map(
          (s) =>
            `🔴 ${escapar(s.name)}${s.incident ? ` · ${escapar(s.incident)}` : ''}`
        )
        .join('\n')}`
    );
  } else if (sitios.length > 0) {
    lineas.push(`🟢 Los ${sitios.length} sitios responden.`);
  }
  if (ejecuciones.length === 0) {
    lineas.push('Ningún servicio ha reportado corridas todavía.');
  } else {
    const icono: Record<EstadoEjecucion, string> = {
      ok: '🟢',
      aviso: '🟡',
      error: '🔴',
      atrasada: '⏰'
    };
    lineas.push(
      `<b>Servicios (${ejecuciones.length})</b>\n${ejecuciones
        .slice(0, 15)
        .map(
          (e) =>
            `${icono[e.estado]} ${escapar(e.nombre)} · ${hace(e.terminoEn, ahora)}${e.estado === 'error' && e.mensaje ? ` · ${escapar(e.mensaje)}` : ''}`
        )
        .join('\n')}`
    );
  }
  return lineas.join('\n\n');
}

function lista(tareas: TaskItem[], maximo: number, conDueno = false): string {
  return tareas
    .slice(0, maximo)
    .map((t) => {
      const partes = [
        t.priority === 'urgente' ? '‼️' : t.priority === 'alta' ? '❗' : '•',
        escapar(t.title),
        t.company ? `· ${escapar(t.company)}` : '',
        conDueno
          ? t.assignee
            ? `· ${escapar(t.assignee.name)}`
            : '· sin responsable'
          : '',
        t.dueDate ? `· ${fechaCorta(new Date(t.dueDate))}` : ''
      ];
      return partes.filter((x) => x).join(' ');
    })
    .join('\n');
}

function hace(iso: string, ahora: Date): string {
  const min = Math.round((ahora.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) {
    return 'ahora';
  }
  if (min < 60) {
    return `hace ${min} min`;
  }
  const h = min / 60;
  return h < 48 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`;
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Mexico_City'
  });
}

function fechaCorta(fecha: Date): string {
  return fecha.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'America/Mexico_City'
  });
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
