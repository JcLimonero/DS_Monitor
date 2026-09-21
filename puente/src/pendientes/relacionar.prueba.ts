import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TaskItem } from '../nucleo/contrato.js';
import { anotar } from './anotaciones.js';
import {
  abiertosParaModelo,
  agregarNovedad,
  asuntoNormalizado,
  candidatosDeRelacion,
  marcarVisto,
  relacionarPorAsunto
} from './relacionar.js';

const base: TaskItem = {
  id: 'correo-nexus-ia-1',
  title: 'Revisar cotización del portal',
  description:
    'Piden revisar la cotización.\n\nDe: Ana <ana@cliente.com>\nPara: yo\nAsunto: Cotización portal de proveedores\n\nHola…',
  status: 'pendiente',
  priority: 'media',
  accountId: 'correo-nexus',
  origin: 'correo',
  tags: ['correo', 'ia'],
  updatedAt: '2026-09-10T10:00:00.000Z'
};

describe('asuntoNormalizado', () => {
  it('quita los RE/RV/Fwd apilados, colapsa espacios y baja a minúsculas', () => {
    assert.equal(
      asuntoNormalizado('RE: RV:  Fwd: Cotización   portal '),
      'cotización portal'
    );
    assert.equal(asuntoNormalizado('Re:Re: Hola'), 'hola');
    assert.equal(asuntoNormalizado('Reporte semanal'), 'reporte semanal');
  });
});

describe('relacionarPorAsunto', () => {
  const otro = { remitente: 'Luis <luis@proveedor.com>' };

  it('una respuesta (RE:) del mismo hilo relaciona aunque venga de otro remitente', () => {
    const t = relacionarPorAsunto(
      { asunto: 'RE: Cotización portal de proveedores', ...otro },
      [base]
    );
    assert.equal(t?.id, base.id);
  });

  it('sin RE: relaciona solo si es el mismo remitente', () => {
    assert.equal(
      relacionarPorAsunto(
        {
          asunto: 'Cotización portal de proveedores',
          remitente: 'Ana Cliente <ANA@cliente.com>'
        },
        [base]
      )?.id,
      base.id
    );
    // Asunto generico, otro remitente y sin RE: no es el mismo hilo.
    assert.equal(
      relacionarPorAsunto(
        { asunto: 'Cotización portal de proveedores', ...otro },
        [base]
      ),
      undefined
    );
  });

  it('no relaciona asuntos distintos ni muy cortos', () => {
    assert.equal(
      relacionarPorAsunto({ asunto: 'RE: Factura 123', ...otro }, [base]),
      undefined
    );
    const corto = {
      ...base,
      description: 'De: x <x@y.com>\nAsunto: Hola'
    };
    assert.equal(
      relacionarPorAsunto({ asunto: 'RE: Hola', ...otro }, [corto]),
      undefined
    );
  });

  it('entre varios gana el más reciente y solo los de correo', () => {
    const viejo = { ...base, id: 'viejo', updatedAt: '2026-01-01T00:00:00Z' };
    const local = { ...base, id: 'local', origin: 'local' as const };
    assert.equal(
      relacionarPorAsunto(
        { asunto: 'RE: Cotización portal de proveedores', ...otro },
        [viejo, base, local]
      )?.id,
      base.id
    );
  });
});

describe('candidatos', () => {
  const ahora = new Date('2026-09-20T12:00:00Z');

  it('excluye los eliminados y los hechos viejos; los hechos no van al modelo', () => {
    const reciente = { ...base, id: 'reciente' };
    const viejo = { ...base, id: 'viejo', updatedAt: '2026-06-01T00:00:00Z' };
    const borrado = { ...base, id: 'borrado' };
    const anotaciones = {
      reciente: {
        hecho: true,
        comentarios: [],
        actualizadoEn: '2026-09-15T00:00:00Z'
      },
      viejo: {
        hecho: true,
        comentarios: [],
        actualizadoEn: '2026-08-01T00:00:00Z'
      },
      borrado: { eliminado: true, comentarios: [], actualizadoEn: '' }
    };
    const candidatos = candidatosDeRelacion(
      [base, reciente, viejo, borrado],
      anotaciones,
      ahora
    );
    assert.deepEqual(
      candidatos.map((t) => t.id),
      [base.id, 'reciente']
    );
    assert.deepEqual(
      abiertosParaModelo(candidatos, anotaciones, () => 'ana@cliente.com'),
      [
        {
          id: base.id,
          titulo: 'Revisar cotización del portal',
          remitente: 'ana@cliente.com'
        }
      ]
    );
  });

  it('un hecho hace 40 días ya no recibe respuestas', () => {
    const hecho = {
      ...base,
      status: 'hecho' as const,
      updatedAt: '2026-08-11T00:00:00Z'
    };
    const candidatos = candidatosDeRelacion([hecho], {}, ahora);
    assert.deepEqual(candidatos, []);
    assert.equal(
      relacionarPorAsunto(
        {
          asunto: 'RE: Cotización portal de proveedores',
          remitente: 'Ana <ana@cliente.com>'
        },
        candidatos
      ),
      undefined
    );
  });
});

describe('agregarNovedad', () => {
  const correo = {
    clave: 'correo-nexus:2026-09-12:ana:re',
    resumen: 'Ana confirma que aceptan la cotización y piden fecha.',
    remitente: 'Ana <ana@cliente.com>',
    asunto: 'RE: Cotización portal de proveedores',
    at: '2026-09-12T09:00:00.000Z'
  };

  it('pone el resumen como comentario, el movimiento y la novedad', () => {
    const nota = agregarNovedad(undefined, correo);
    assert.equal(nota.comentarios.length, 1);
    assert.equal(nota.comentarios[0]?.by, 'Correo');
    assert.match(nota.comentarios[0]?.text ?? '', /^Ana confirma/);
    assert.match(
      nota.comentarios[0]?.text ?? '',
      /— Ana <ana@cliente.com>, RE:/
    );
    assert.deepEqual(nota.novedad, { at: correo.at, text: correo.resumen });
    assert.equal(nota.historial?.[0]?.kind, 'comentario');
    assert.match(nota.historial?.[0]?.text ?? '', /^Correo nuevo: Ana/);
    assert.equal(nota.actualizadoEn, correo.at);
  });

  it('el mismo correo no se anota dos veces', () => {
    const una = agregarNovedad(undefined, correo);
    const dos = agregarNovedad(una, correo);
    assert.equal(dos, una);
    assert.equal(dos.comentarios.length, 1);
  });

  it('un pendiente hecho se queda hecho, pero con novedad', () => {
    const nota = agregarNovedad(
      { hecho: true, estado: 'hecho', comentarios: [], actualizadoEn: '' },
      correo
    );
    assert.equal(nota.hecho, true);
    assert.ok(nota.novedad);
    const [servido] = anotar([base], { [base.id]: nota });
    assert.equal(servido?.status, 'hecho');
    assert.equal(servido?.unread?.text, correo.resumen);
  });

  it('marcarVisto quita la novedad y deja el comentario', () => {
    const nota = agregarNovedad(undefined, correo);
    const vista = marcarVisto(nota);
    assert.equal(vista?.novedad, undefined);
    assert.equal(vista?.comentarios.length, 1);
    assert.equal(marcarVisto(undefined), undefined);
    const sinNovedad = { comentarios: [], actualizadoEn: '' };
    assert.equal(marcarVisto(sinNovedad), sinNovedad);
  });
});
