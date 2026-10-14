import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ROL_COMERCIAL,
  ROL_DESARROLLO,
  ROL_DIRECTOR
} from '../datos/roles-permisos.js';
import { pendientesDeTranscripcion } from '../ia/juntas-fireflies.js';
import type { JuntaRag, UsuarioCrm } from '../nucleo/contrato.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import { carpetaDeEmpresa, leerCuentaServicio } from './config.js';
import { actorDe, juntaVisible } from './permisos.js';

function transcripcion(
  parcial: Partial<Transcripcion> & Pick<Transcripcion, 'id' | 'titulo'>
): Transcripcion {
  return {
    fecha: '2026-10-12T18:00:00.000Z',
    participantes: [],
    ...parcial
  };
}

function usuario(roles: string[], alcance?: UsuarioCrm['alcance']): UsuarioCrm {
  return {
    id: roles.join('-') || 'u',
    correo: 'persona@ejemplo.test',
    nombre: 'Persona',
    roles,
    alcance,
    activo: true,
    actualizadoEn: '2026-01-01T00:00:00.000Z'
  };
}

function junta(parcial: Partial<JuntaRag> & Pick<JuntaRag, 'id'>): JuntaRag {
  return {
    titulo: 'Junta',
    fecha: '2026-10-12T18:00:00.000Z',
    participantes: [],
    texto: 'texto',
    estado: 'archivada',
    esItech: false,
    driveConfirmado: true,
    borradaDeFireflies: false,
    actualizadoEn: '2026-10-12T18:00:00.000Z',
    ...parcial
  };
}

describe('pendiente de Itech', () => {
  it('crea el padre con subtareas y empresa Itech Dev, igual que cualquier junta', async () => {
    const padre = await pendientesDeTranscripcion(
      undefined,
      transcripcion({
        id: 'ff-itech',
        titulo: 'Junta interna',
        participantes: ['climon@itechdev.com.mx'],
        acuerdos: '**Ana Solís**\nPreparar el entorno de pruebas (02:00)'
      }),
      [{ id: 'ana', name: 'Ana Solís', email: 'ana@ejemplo.test' }]
    );
    assert.ok(padre);
    assert.equal(padre?.id, 'fireflies-ff-itech');
    assert.equal(padre?.company, 'Itech Dev');
    assert.equal(padre?.project, 'Junta interna');
    assert.equal(padre?.subtareas?.length, 1);
    assert.equal(
      padre?.subtareas?.[0]?.titulo,
      'Preparar el entorno de pruebas'
    );
    assert.equal(padre?.subtareas?.[0]?.responsables?.[0]?.id, 'ana');
    assert.equal(padre?.tags?.includes('junta'), true);
  });

  it('una junta de Itech por el titulo tambien crea el padre con sus acuerdos', async () => {
    const padre = await pendientesDeTranscripcion(
      undefined,
      transcripcion({
        id: 'ff-itech-titulo',
        titulo: 'Seguimiento Itech Dev',
        participantes: ['ana@ejemplo.test'],
        acuerdos:
          '**Ana Solís**\nCerrar el alcance (01:00)\n**Luis Mora**\nSubir el ambiente (03:10)'
      }),
      [
        { id: 'ana', name: 'Ana Solís', email: 'ana@ejemplo.test' },
        { id: 'luis', name: 'Luis Mora', email: 'luis@ejemplo.test' }
      ]
    );
    assert.ok(padre);
    assert.equal(padre?.id, 'fireflies-ff-itech-titulo');
    assert.equal(padre?.company, 'Itech Dev');
    assert.equal(padre?.project, 'Seguimiento Itech Dev');
    assert.equal(padre?.subtareas?.length, 2);
    assert.equal(padre?.subtareas?.[0]?.responsables?.[0]?.id, 'ana');
    assert.equal(padre?.subtareas?.[1]?.responsables?.[0]?.id, 'luis');
  });
});

describe('permisos de juntas', () => {
  const proyectos = [
    {
      id: 'proy-portal',
      clienteId: 'cli-norte',
      empresaAtiendeId: 'dealer-solutions'
    }
  ];
  const archivada = junta({
    id: 'a',
    proyectoId: 'proy-portal',
    clienteId: 'cli-norte'
  });
  const otra = junta({
    id: 'b',
    proyectoId: 'proy-otro',
    clienteId: 'cli-otro'
  });
  const itech = junta({
    id: 'i',
    esItech: true,
    proyectoId: undefined,
    clienteId: undefined
  });
  const bandeja = junta({
    id: 's',
    estado: 'sin_asignar',
    driveConfirmado: false
  });

  it('el director ve la bandeja y todo lo archivado', () => {
    const actor = actorDe(usuario(['director']), [ROL_DIRECTOR]);
    assert.equal(juntaVisible(bandeja, actor, proyectos), true);
    assert.equal(juntaVisible(itech, actor, proyectos), true);
    assert.equal(juntaVisible(otra, actor, proyectos), true);
  });

  it('desarrollo solo ve las juntas de sus proyectos', () => {
    const actor = actorDe(
      usuario(['desarrollo'], { proyectos: ['proy-portal'] }),
      [ROL_DESARROLLO]
    );
    assert.equal(juntaVisible(archivada, actor, proyectos), true);
    assert.equal(juntaVisible(otra, actor, proyectos), false);
    assert.equal(juntaVisible(itech, actor, proyectos), false);
    assert.equal(juntaVisible(bandeja, actor, proyectos), false);
  });

  it('comercial sin alcance ve lo archivado, no la bandeja', () => {
    const actor = actorDe(usuario(['comercial']), [ROL_COMERCIAL]);
    assert.equal(juntaVisible(archivada, actor, proyectos), true);
    assert.equal(juntaVisible(itech, actor, proyectos), true);
    assert.equal(juntaVisible(bandeja, actor, proyectos), false);
  });
});

describe('configuracion del RAG', () => {
  it('lee la cuenta de servicio y rechaza JSON incompleto', () => {
    assert.equal(leerCuentaServicio('no es json'), undefined);
    assert.equal(
      leerCuentaServicio(JSON.stringify({ client_email: 'a@b.test' })),
      undefined
    );
    const cuenta = leerCuentaServicio(
      JSON.stringify({
        client_email: 'rag@ejemplo.test',
        private_key:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----'
      })
    );
    assert.equal(cuenta?.clientEmail, 'rag@ejemplo.test');
    assert.match(cuenta?.privateKey ?? '', /BEGIN PRIVATE KEY/);
    assert.equal(cuenta?.privateKey.includes('\\n'), false);
    assert.equal(
      carpetaDeEmpresa('itech-dev', [
        { empresaId: 'itech-dev', carpetaId: 'carpeta-ficticia' }
      ]),
      'carpeta-ficticia'
    );
  });
});
