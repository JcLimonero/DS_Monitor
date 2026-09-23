import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  esCorreoAria,
  esCuentaItech,
  juntaDesdeAria,
  parsearConsultaAria,
  resumenCliente,
  yaAgendadaAria
} from './aria.js';
import type { Meeting } from '../nucleo/contrato.js';

const ASUNTO =
  'Nueva consulta agendada: Fernanda López · jue 24 sep · 12:15 p.m.';

const REMITENTE =
  'ARIA — Plataforma central de iTechDev <avisos@meet.itechdev.com.mx>';

/** Texto sintético equivalente al correo de Fernanda López (tras sinEtiquetas). */
const CUERPO = `
Nueva consulta agendada
aviso interno · meet.itechdev.com.mx

Fernanda López · GALSA rent

Nombre Fernanda López
Correo fernandalopez280804@gmail.com
Teléfono / WhatsApp +526182111412 · wa.me/526182111412
Empresa GALSA rent
Fecha y hora jueves 24 de septiembre, 12:15 p.m. (hora de Monterrey) · 45 min
Zona horaria del asistente America/Monterrey
Tema Consulta con iTechDev entre Equipo iTechDev y Fernanda López
Enlace Teams https://teams.microsoft.com/l/meetup-join/19%3ameeting_YjBkYWZiMjctOWJhNi00OTI4LWIyZTQtY2Y5ZGNjZGU3NDUy%40thread.v2/0?context=%7b%22Tid%22%3a%22a6171d24-aba2-4f6c-a3fd-2049853abce9%22%2c%22Oid%22%3a%228e9c064f-4feb-4aff-b3fb-1f529aa72a4e%22%7d
Cita en Cal https://meet.itechdev.com.mx/booking/cX2KmPkzG723gXrZPWEdvc
¿En qué podemos ayudarle? Otro / No está seguro
¿Cómo nos encontró? Otro
¿Para cuándo? Solo está explorando
Presupuesto estimado Aún no lo definen
Rol en la empresa Operaciones
¿Qué usan hoy? Otro ERP

Al prospecto ya se le envió el WhatsApp y el correo corporativo de confirmación.
`.trim();

describe('esCorreoAria', () => {
  it('detecta por asunto Nueva consulta agendada', () => {
    assert.equal(esCorreoAria(ASUNTO, 'alguien@ejemplo.com'), true);
  });

  it('detecta por remitente ARIA / meet.itechdev', () => {
    assert.equal(
      esCorreoAria('Consulta agendada con Fernanda', REMITENTE),
      true
    );
  });

  it('ignora correos ajenos', () => {
    assert.equal(
      esCorreoAria('Minuta de la junta', 'Ana <ana@ejemplo.com>'),
      false
    );
  });
});

describe('esCuentaItech', () => {
  it('solo los ids exactos de iTechDev', () => {
    assert.equal(esCuentaItech('correo-itech'), true);
    assert.equal(esCuentaItech('correo-itech-alterno'), true);
    assert.equal(esCuentaItech('itech'), false);
    assert.equal(esCuentaItech('correo-nexus'), false);
  });
});

describe('parsearConsultaAria', () => {
  it('parsea el correo de Fernanda López (2026-09-24 12:15 Monterrey)', () => {
    const c = parsearConsultaAria(ASUNTO, CUERPO, 2026);
    assert.ok(c);
    assert.equal(c!.nombre, 'Fernanda López');
    assert.equal(c!.empresa, 'GALSA rent');
    assert.equal(c!.correo, 'fernandalopez280804@gmail.com');
    assert.equal(c!.telefono, '+526182111412');
    assert.equal(c!.zona, 'America/Monterrey');
    // 12:15 America/Monterrey (UTC−6) = 18:15Z
    assert.equal(c!.inicio, '2026-09-24T18:15:00.000Z');
    assert.equal(c!.fin, '2026-09-24T19:00:00.000Z');
    assert.ok(c!.teamsUrl?.includes('teams.microsoft.com'));
    assert.ok(c!.citaUrl?.includes('meet.itechdev.com.mx/booking/'));
    assert.match(
      Object.values(c!.respuestas).join(' '),
      /Operaciones|Otro ERP|Solo está explorando/
    );
  });

  it('cae al asunto si el cuerpo no trae fecha completa', () => {
    const c = parsearConsultaAria(
      ASUNTO,
      'Nombre Fernanda López\nEmpresa GALSA rent\n',
      2026
    );
    assert.ok(c);
    assert.equal(c!.inicio, '2026-09-24T18:15:00.000Z');
    assert.equal(c!.fin, '2026-09-24T19:00:00.000Z');
  });
});

describe('resumenCliente y juntaDesdeAria', () => {
  it('arma resumen con GALSA / Operaciones / Otro ERP y junta con título correcto', () => {
    const c = parsearConsultaAria(ASUNTO, CUERPO, 2026)!;
    const resumen = resumenCliente(c);
    assert.match(resumen, /GALSA rent/);
    assert.match(resumen, /Operaciones/);
    assert.match(resumen, /Otro ERP/);
    assert.match(resumen, /teams\.microsoft\.com/);

    const junta = juntaDesdeAria(c);
    assert.equal(junta.titulo, 'Consulta ARIA: Fernanda López · GALSA rent');
    assert.equal(junta.inicio, '2026-09-24T18:15:00.000Z');
    assert.equal(junta.fin, '2026-09-24T19:00:00.000Z');
    assert.equal(junta.enLinea, false);
    assert.equal(junta.invitados?.[0], 'fernandalopez280804@gmail.com');
    assert.ok(junta.lugar?.includes('teams.microsoft.com'));
    assert.equal(junta.cuerpo, resumen);
  });
});

describe('yaAgendadaAria', () => {
  it('dedupe por mismo minuto de inicio + nombre en título', () => {
    const c = parsearConsultaAria(ASUNTO, CUERPO, 2026)!;
    const juntas: Meeting[] = [
      {
        id: 'x',
        title: 'Consulta ARIA: Fernanda López · GALSA rent',
        start: '2026-09-24T18:15:00.000Z',
        end: '2026-09-24T19:00:00.000Z',
        allDay: false,
        accountId: 'correo-itech',
        status: 'confirmada',
        attendees: []
      }
    ];
    assert.equal(yaAgendadaAria(juntas, c), true);
    assert.equal(
      yaAgendadaAria(
        [
          {
            ...juntas[0]!,
            start: '2026-09-24T19:00:00.000Z'
          }
        ],
        c
      ),
      false
    );
  });
});
