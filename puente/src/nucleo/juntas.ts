import type { Meeting } from './contrato.js';

/**
 * Homologacion de juntas entre cuentas (misma logica que el portal, en
 * `core/util/meetings.util.ts`): la misma junta en dos calendarios se funde
 * en una con las demas cuentas en `alsoIn`, y una junta que esta en un
 * calendario y no en otro es un aviso.
 */
export function claveDeJunta(m: Meeting): string {
  const titulo = texto(m.title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${titulo}|${texto(m.start).slice(0, 16)}|${texto(m.end).slice(0, 16)}`;
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

export function homologarJuntas(juntas: readonly Meeting[]): Meeting[] {
  const porClave = new Map<string, Meeting>();
  for (const m of juntas) {
    const clave = claveDeJunta(m);
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

export function cuentasDeJunta(m: Meeting): string[] {
  return [m.accountId, ...(m.alsoIn ?? [])];
}

/** Juntas futuras que faltan en alguna de las cuentas con calendario. */
export function juntasSinHomologar(
  homologadas: readonly Meeting[],
  cuentasConCalendario: readonly string[],
  ahora = new Date()
): { junta: Meeting; faltaEn: string[] }[] {
  if (cuentasConCalendario.length < 2) {
    return [];
  }
  return homologadas
    .filter(
      (m) => m.status !== 'cancelada' && Date.parse(m.end) >= ahora.getTime()
    )
    .map((junta) => {
      const presentes = new Set(cuentasDeJunta(junta));
      return {
        junta,
        faltaEn: cuentasConCalendario.filter((c) => !presentes.has(c))
      };
    })
    .filter((u) => u.faltaEn.length > 0)
    .sort((a, b) => a.junta.start.localeCompare(b.junta.start));
}
