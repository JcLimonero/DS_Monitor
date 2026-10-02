import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LlamadaArchivada } from '../models';
import {
  duracionLlamada,
  filtrarLlamadas,
  resumenParticipantes
} from './llamadas.util';

const llamada = (
  id: string,
  titulo: string,
  participantes: string[] = []
): LlamadaArchivada => ({
  id,
  titulo,
  fecha: '2026-09-30T16:30:00Z',
  participantes,
  docUrl: `https://docs.google.com/document/d/${id}/edit`,
  docId: id,
  archivadaEn: '2026-10-01T00:00:00Z',
  borradaDeFireflies: true
});

describe('filtrarLlamadas', () => {
  const lista = [
    llamada('a', 'Junta con Vanguardia', ['ana@dealer.mx']),
    llamada('b', 'Revisión de presupuesto', ['beto@birdom.mx', 'Carla'])
  ];

  it('sin búsqueda devuelve todo', () => {
    assert.equal(filtrarLlamadas(lista, '  '), lista);
  });

  it('busca en título y participantes sin acentos ni mayúsculas', () => {
    assert.deepEqual(
      filtrarLlamadas(lista, 'revision').map((l) => l.id),
      ['b']
    );
    assert.deepEqual(
      filtrarLlamadas(lista, 'ANA@dealer').map((l) => l.id),
      ['a']
    );
    assert.deepEqual(
      filtrarLlamadas(lista, 'carla presupuesto').map((l) => l.id),
      ['b']
    );
    assert.deepEqual(filtrarLlamadas(lista, 'nada'), []);
  });
});

describe('duracionLlamada y participantes', () => {
  it('formatea la duración', () => {
    assert.equal(duracionLlamada(undefined), '');
    assert.equal(duracionLlamada(45), '45 min');
    assert.equal(duracionLlamada(60), '1 h');
    assert.equal(duracionLlamada(65), '1 h 05 min');
  });

  it('recorta la lista de participantes', () => {
    assert.equal(resumenParticipantes(['a', 'b']), 'a, b');
    assert.equal(
      resumenParticipantes(['a', 'b', 'c', 'd', 'e']),
      'a, b, c y 2 más'
    );
  });
});
