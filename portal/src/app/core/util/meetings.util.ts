import { Meeting } from '../models';

/**
 * Homologación de juntas entre cuentas.
 *
 * La misma junta suele estar en dos calendarios (la invitación llega al
 * correo de Nexus y al de Itech). Se funden en una: la primera copia se
 * queda y las demás cuentas quedan en `alsoIn`. Y al revés, una junta que
 * está en un calendario y no en otro es un aviso: falta aceptarla o
 * reenviarla para que todas las cuentas tengan lo mismo.
 */

/** Lo que hace a dos juntas la misma: título normalizado, inicio y fin. */
export function meetingKey(m: Meeting): string {
  const titulo = m.title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${titulo}|${m.start.slice(0, 16)}|${m.end.slice(0, 16)}`;
}

export function mergeMeetings(meetings: readonly Meeting[]): Meeting[] {
  const porClave = new Map<string, Meeting>();
  for (const m of meetings) {
    const clave = meetingKey(m);
    const previa = porClave.get(clave);
    if (!previa) {
      porClave.set(clave, { ...m, alsoIn: m.alsoIn ? [...m.alsoIn] : [] });
      continue;
    }
    if (
      previa.accountId !== m.accountId &&
      !previa.alsoIn?.includes(m.accountId)
    ) {
      previa.alsoIn = [...(previa.alsoIn ?? []), m.accountId];
    }
    // La copia con más datos completa a la otra.
    previa.joinUrl = previa.joinUrl ?? m.joinUrl;
    previa.notes = previa.notes ?? m.notes;
    previa.location = previa.location ?? m.location;
    if (previa.attendees.length < m.attendees.length) {
      previa.attendees = m.attendees;
    }
    if (previa.status === 'cancelada' && m.status !== 'cancelada') {
      previa.status = m.status;
    }
  }
  return [...porClave.values()].map((m) =>
    m.alsoIn && m.alsoIn.length > 0 ? m : { ...m, alsoIn: undefined }
  );
}

/** Todas las cuentas en las que está una junta ya fundida. */
export function accountsOf(m: Meeting): string[] {
  return [m.accountId, ...(m.alsoIn ?? [])];
}

export interface UnmirroredMeeting {
  meeting: Meeting;
  /** Cuentas con calendario donde la junta no aparece. */
  missingIn: string[];
}

/**
 * Juntas futuras (no canceladas) que faltan en alguna de las cuentas que
 * tienen calendario. `calendarAccounts` son las cuentas que sí traen juntas.
 */
export function unmirroredMeetings(
  merged: readonly Meeting[],
  calendarAccounts: readonly string[],
  now = new Date()
): UnmirroredMeeting[] {
  if (calendarAccounts.length < 2) {
    return [];
  }
  return merged
    .filter(
      (m) => m.status !== 'cancelada' && Date.parse(m.end) >= now.getTime()
    )
    .map((m) => {
      const presentes = new Set(accountsOf(m));
      return {
        meeting: m,
        missingIn: calendarAccounts.filter((c) => !presentes.has(c))
      };
    })
    .filter((u) => u.missingIn.length > 0)
    .sort((a, b) => a.meeting.start.localeCompare(b.meeting.start));
}
