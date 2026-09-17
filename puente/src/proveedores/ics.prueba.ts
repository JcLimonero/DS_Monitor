import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extraerCalendario, fechaIso, juntasDeCalendario } from './ics.js';

const ICS_GOOGLE = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'DTSTART:20260918T160000Z',
  'DTEND:20260918T170000Z',
  'DTSTAMP:20260916T100000Z',
  'ORGANIZER;CN=Ana Robles:mailto:ana@ejemplo.com',
  'UID:abc123@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=yo@',
  ' ejemplo.com;X-NUM-GUESTS=0:mailto:yo@ejemplo.com',
  'ATTENDEE;PARTSTAT=ACCEPTED;CN=Ana Robles:mailto:ana@ejemplo.com',
  'SUMMARY:Revisión de la integración\\, parte 2',
  'LOCATION:Sala 2',
  'DESCRIPTION:Traer el conteo.\\nUnirse: https://meet.google.com/abc-defg-hij',
  'SEQUENCE:0',
  'STATUS:CONFIRMED',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

describe('extraerCalendario', () => {
  it('saca la parte text/calendar de un mensaje multipart', () => {
    const mensaje = [
      'From: Ana <ana@ejemplo.com>',
      'Content-Type: multipart/alternative; boundary="XYZ"',
      '',
      '--XYZ',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Te invito a una junta',
      '--XYZ',
      'Content-Type: text/calendar; charset="UTF-8"; method=REQUEST',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(ICS_GOOGLE)
        .toString('base64')
        .replace(/(.{76})/g, '$1\r\n'),
      '--XYZ--'
    ].join('\r\n');
    const ics = extraerCalendario(mensaje);
    assert.ok(ics?.includes('SUMMARY:Revisión'));
  });

  it('entiende quoted-printable', () => {
    const mensaje = [
      'Content-Type: multipart/mixed; boundary="B"',
      '',
      '--B',
      'Content-Type: text/calendar; method=REQUEST',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Revisi=C3=B3n',
      'END:VEVENT',
      'END:VCALENDAR',
      '--B--'
    ].join('\r\n');
    assert.ok(extraerCalendario(mensaje)?.includes('SUMMARY:Revisión'));
  });

  it('sin parte de calendario no devuelve nada', () => {
    assert.equal(
      extraerCalendario('Content-Type: text/plain\r\n\r\nhola'),
      undefined
    );
  });
});

describe('juntasDeCalendario', () => {
  it('traduce una invitación de Google al modelo del portal', () => {
    const [junta] = juntasDeCalendario(
      [ICS_GOOGLE],
      'correo-gmail',
      'yo@ejemplo.com'
    );
    assert.equal(junta?.id, 'correo-gmail-abc123@google.com');
    assert.equal(junta?.title, 'Revisión de la integración, parte 2');
    assert.equal(junta?.start, '2026-09-18T16:00:00.000Z');
    assert.equal(junta?.end, '2026-09-18T17:00:00.000Z');
    assert.equal(junta?.allDay, false);
    // Todavía no la contesté: no cuenta como confirmada.
    assert.equal(junta?.status, 'tentativa');
    assert.equal(junta?.organizer?.name, 'Ana Robles');
    assert.equal(junta?.attendees.length, 2);
    assert.equal(junta?.location, 'Sala 2');
    assert.equal(junta?.joinUrl, 'https://meet.google.com/abc-defg-hij');
  });

  it('la cancelación gana sobre la invitación original', () => {
    const cancelacion = ICS_GOOGLE.replace('METHOD:REQUEST', 'METHOD:CANCEL')
      .replace('SEQUENCE:0', 'SEQUENCE:1')
      .replace('STATUS:CONFIRMED', 'STATUS:CANCELLED');
    const juntas = juntasDeCalendario(
      [cancelacion, ICS_GOOGLE],
      'correo-gmail',
      'yo@ejemplo.com'
    );
    assert.equal(juntas.length, 1);
    assert.equal(juntas[0]?.status, 'cancelada');
  });

  it('una aceptada es confirmada', () => {
    const aceptada = ICS_GOOGLE.replace(
      'PARTSTAT=NEEDS-ACTION',
      'PARTSTAT=ACCEPTED'
    );
    const [junta] = juntasDeCalendario([aceptada], 'x', 'yo@ejemplo.com');
    assert.equal(junta?.status, 'confirmada');
  });

  it('un evento de todo el día dura un día', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:dia',
      'DTSTART;VALUE=DATE:20260920',
      'SUMMARY:Feriado',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const [junta] = juntasDeCalendario([ics], 'x', 'yo@ejemplo.com');
    assert.equal(junta?.allDay, true);
    assert.equal(junta?.start, '2026-09-20T00:00:00.000Z');
    assert.equal(junta?.end, '2026-09-21T00:00:00.000Z');
  });
});

describe('fechaIso', () => {
  it('convierte la hora local de una zona IANA', () => {
    assert.equal(
      fechaIso({
        nombre: 'DTSTART',
        parametros: { TZID: 'America/Mexico_City' },
        valor: '20260918T100000'
      }),
      '2026-09-18T16:00:00.000Z'
    );
  });

  it('acepta los nombres de zona de Windows que manda Outlook', () => {
    assert.equal(
      fechaIso({
        nombre: 'DTSTART',
        parametros: { TZID: 'Central Standard Time (Mexico)' },
        valor: '20260918T100000'
      }),
      '2026-09-18T16:00:00.000Z'
    );
  });

  it('sin zona ni Z se toma como UTC', () => {
    assert.equal(
      fechaIso({ nombre: 'DTSTART', parametros: {}, valor: '20260918T100000' }),
      '2026-09-18T10:00:00.000Z'
    );
  });

  it('rechaza lo que no es fecha', () => {
    assert.equal(
      fechaIso({ nombre: 'DTSTART', parametros: {}, valor: 'mañana' }),
      undefined
    );
  });
});
