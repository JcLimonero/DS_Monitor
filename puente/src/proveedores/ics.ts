import type { Meeting, MeetingStatus, Person } from '../nucleo/contrato.js';
import { decodificarTexto } from './imap.js';
import { parteDe } from './mime.js';

/**
 * Invitaciones de calendario que llegan por correo.
 *
 * Google, Microsoft, Zoom y casi todos mandan la invitacion con una parte
 * `text/calendar` (iCalendar, RFC 5545). De ahi se saca la junta: titulo,
 * cuando, quien organiza, quien va y la liga de la videollamada.
 *
 * Es lo que se puede ver **sin** entrar al calendario: solo lo que alguien
 * mando por correo. Una junta que uno crea directo en su calendario no pasa
 * por aqui.
 */

// --- Sacar el iCalendar del mensaje MIME ---

/**
 * La parte `text/calendar` de un mensaje crudo, ya decodificada. Sin esa
 * parte devuelve `undefined`. Algunos mensajes son un solo `text/calendar`
 * sin multipart; `partesDe` tambien los ve porque el mensaje entero es un
 * trozo con encabezados.
 */
export function extraerCalendario(mensaje: string): string | undefined {
  const parte = parteDe(mensaje, 'text/calendar');
  return parte && /BEGIN:VCALENDAR/.test(parte) ? parte : undefined;
}

// --- iCalendar a juntas ---

interface Propiedad {
  nombre: string;
  parametros: Record<string, string>;
  valor: string;
}

/** Cada VEVENT como lista de propiedades, ya con las lineas desdobladas. */
export function eventosDe(ics: string): Propiedad[][] {
  const lineas = ics
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter(Boolean);
  const eventos: Propiedad[][] = [];
  let metodo: string | undefined;
  let actual: Propiedad[] | undefined;
  for (const linea of lineas) {
    if (linea === 'BEGIN:VEVENT') {
      actual = metodo
        ? [{ nombre: 'METHOD', parametros: {}, valor: metodo }]
        : [];
      continue;
    }
    if (linea === 'END:VEVENT') {
      if (actual) {
        eventos.push(actual);
      }
      actual = undefined;
      continue;
    }
    const propiedad = interpretarPropiedad(linea);
    if (!propiedad) {
      continue;
    }
    if (!actual && propiedad.nombre === 'METHOD') {
      metodo = propiedad.valor;
    }
    actual?.push(propiedad);
  }
  return eventos;
}

function interpretarPropiedad(linea: string): Propiedad | undefined {
  // El valor empieza en el primer ':' fuera de comillas; los parametros van
  // antes separados por ';'.
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      enComillas = !enComillas;
    } else if (c === ':' && !enComillas) {
      const cabeza = linea.slice(0, i).split(';');
      const nombre = (cabeza[0] ?? '').toUpperCase();
      if (!nombre) {
        return undefined;
      }
      const parametros: Record<string, string> = {};
      for (const parametro of cabeza.slice(1)) {
        const igual = parametro.indexOf('=');
        if (igual > 0) {
          parametros[parametro.slice(0, igual).toUpperCase()] = parametro
            .slice(igual + 1)
            .replace(/^"|"$/g, '');
        }
      }
      return { nombre, parametros, valor: desescapar(linea.slice(i + 1)) };
    }
  }
  return undefined;
}

function desescapar(valor: string): string {
  return valor
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function primera(evento: Propiedad[], nombre: string): Propiedad | undefined {
  return evento.find((p) => p.nombre === nombre);
}

function todas(evento: Propiedad[], nombre: string): Propiedad[] {
  return evento.filter((p) => p.nombre === nombre);
}

/**
 * Junta las invitaciones de varios mensajes y devuelve una junta por evento.
 *
 * El mismo evento llega varias veces (la invitacion, una actualizacion, la
 * cancelacion): gana el de mayor SEQUENCE y, a igual secuencia, el DTSTAMP
 * mas reciente. `usuario` es el correo del buzon: sirve para saber si la
 * invitacion ya se acepto o sigue esperando respuesta.
 */
export function juntasDeCalendario(
  calendarios: string[],
  accountId: string,
  usuario: string
): Meeting[] {
  const porUid = new Map<string, { orden: [number, string]; junta: Meeting }>();
  for (const ics of calendarios) {
    for (const evento of eventosDe(ics)) {
      const junta = juntaDe(evento, accountId, usuario);
      if (!junta) {
        continue;
      }
      const uid = primera(evento, 'UID')?.valor ?? junta.id;
      const orden: [number, string] = [
        Number(primera(evento, 'SEQUENCE')?.valor ?? 0),
        primera(evento, 'DTSTAMP')?.valor ?? ''
      ];
      const anterior = porUid.get(uid);
      if (
        anterior &&
        (anterior.orden[0] > orden[0] ||
          (anterior.orden[0] === orden[0] && anterior.orden[1] >= orden[1]))
      ) {
        continue;
      }
      porUid.set(uid, { orden, junta });
    }
  }
  // Las canceladas se quedan: el portal las muestra tachadas, y saber que se
  // cancelo una junta es tan util como saber que existe.
  return [...porUid.values()]
    .map((entrada) => entrada.junta)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function juntaDe(
  evento: Propiedad[],
  accountId: string,
  usuario: string
): Meeting | undefined {
  const inicio = primera(evento, 'DTSTART');
  const uid = primera(evento, 'UID')?.valor;
  if (!inicio || !uid) {
    return undefined;
  }
  const todoElDia = inicio.parametros['VALUE'] === 'DATE';
  const start = fechaIso(inicio);
  if (!start) {
    return undefined;
  }
  const fin = primera(evento, 'DTEND');
  const end =
    (fin && fechaIso(fin)) ??
    new Date(
      new Date(start).getTime() + (todoElDia ? 86_400_000 : 3_600_000)
    ).toISOString();

  const organizador = persona(primera(evento, 'ORGANIZER'));
  const asistentes = todas(evento, 'ATTENDEE');
  const yo = asistentes.find(
    (a) => a.valor.toLowerCase() === `mailto:${usuario.toLowerCase()}`
  );
  const descripcion = primera(evento, 'DESCRIPTION')?.valor ?? '';
  const liga =
    primera(evento, 'X-GOOGLE-CONFERENCE')?.valor ??
    primera(evento, 'X-MICROSOFT-SKYPETEAMSMEETINGURL')?.valor ??
    primera(evento, 'URL')?.valor ??
    ligaDeVideollamada(
      `${primera(evento, 'LOCATION')?.valor ?? ''}\n${descripcion}`
    );

  return {
    id: `${accountId}-${uid}`,
    title: primera(evento, 'SUMMARY')?.valor || '(sin título)',
    start,
    end,
    allDay: todoElDia,
    accountId,
    status: estadoDe(evento, yo),
    organizer: organizador,
    attendees: asistentes
      .map((a) => persona(a))
      .filter((p): p is Person => p !== undefined),
    location: primera(evento, 'LOCATION')?.valor || undefined,
    joinUrl: liga,
    notes: descripcion.trim().slice(0, 500) || undefined
  };
}

function estadoDe(
  evento: Propiedad[],
  yo: Propiedad | undefined
): MeetingStatus {
  const metodo = primera(evento, 'METHOD')?.valor.toUpperCase();
  const estado = primera(evento, 'STATUS')?.valor.toUpperCase();
  if (metodo === 'CANCEL' || estado === 'CANCELLED') {
    return 'cancelada';
  }
  if (estado === 'TENTATIVE') {
    return 'tentativa';
  }
  // Una invitacion que todavia no se contesta no es una junta confirmada.
  const respuesta = yo?.parametros['PARTSTAT']?.toUpperCase();
  if (respuesta === 'NEEDS-ACTION' || respuesta === 'TENTATIVE') {
    return 'tentativa';
  }
  return 'confirmada';
}

function persona(propiedad: Propiedad | undefined): Person | undefined {
  if (!propiedad) {
    return undefined;
  }
  const email = propiedad.valor
    .replace(/^mailto:/i, '')
    .trim()
    .toLowerCase();
  if (!email) {
    return undefined;
  }
  const nombre = propiedad.parametros['CN']
    ? decodificarTexto(propiedad.parametros['CN'])
    : (email.split('@')[0] ?? email);
  return { id: email, name: nombre, email };
}

function ligaDeVideollamada(texto: string): string | undefined {
  const liga =
    /https?:\/\/[^\s<>"']*(meet\.google\.com|zoom\.us\/j|teams\.microsoft\.com|teams\.live\.com|webex\.com)[^\s<>"']*/i.exec(
      texto
    );
  return liga?.[0];
}

/**
 * Una fecha iCalendar a ISO con zona.
 *
 * Tres formas: `20260918T160000Z` (UTC), `20260918T100000` con `TZID` (hora
 * local de esa zona) y `20260918` (todo el dia). Para la zona se usa Intl, que
 * ya trae la base de datos de zonas; sin `TZID` se toma como UTC, que es lo
 * menos malo cuando el emisor no dijo.
 */
export function fechaIso(propiedad: Propiedad): string | undefined {
  const valor = propiedad.valor.trim();
  const partes = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    valor
  );
  if (!partes) {
    return undefined;
  }
  const [, a, m, d, hh = '00', mm = '00', ss = '00', utc] = partes;
  const comoUtc = Date.UTC(
    Number(a),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  const zona = propiedad.parametros['TZID'];
  if (utc || !zona || propiedad.parametros['VALUE'] === 'DATE') {
    return new Date(comoUtc).toISOString();
  }
  const desfase = desfaseDeZona(zona, comoUtc);
  if (desfase === undefined) {
    return new Date(comoUtc).toISOString();
  }
  return new Date(comoUtc - desfase).toISOString();
}

/** Milisegundos que la zona esta adelante de UTC en ese instante. */
function desfaseDeZona(zona: string, instante: number): number | undefined {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(new Date(instante));
    const campo = (tipo: string) =>
      Number(partes.find((p) => p.type === tipo)?.value ?? '0');
    const local = Date.UTC(
      campo('year'),
      campo('month') - 1,
      campo('day'),
      campo('hour'),
      campo('minute'),
      campo('second')
    );
    return local - instante;
  } catch {
    // Zonas como "Central Standard Time" (Outlook) no las conoce Intl.
    return desfaseWindows(zona);
  }
}

/**
 * Las zonas con nombre de Windows mas comunes por aca. Es una aproximacion:
 * no considera horario de verano, que en Mexico ya no aplica y en Estados
 * Unidos desplazaria una hora.
 */
function desfaseWindows(zona: string): number | undefined {
  const horas: Record<string, number> = {
    'Central Standard Time (Mexico)': -6,
    'Central Standard Time': -6,
    'Mountain Standard Time (Mexico)': -7,
    'Pacific Standard Time (Mexico)': -8,
    'Eastern Standard Time': -5,
    'Pacific Standard Time': -8,
    'Mountain Standard Time': -7
  };
  const h = horas[zona];
  return h === undefined ? undefined : h * 3_600_000;
}
