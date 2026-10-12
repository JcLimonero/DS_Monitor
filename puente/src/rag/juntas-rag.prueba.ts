import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Empresa } from '../datos/empresas.js';
import {
  ROL_COMERCIAL,
  ROL_DESARROLLO,
  ROL_DIRECTOR
} from '../datos/roles-permisos.js';
import { pendientesDeTranscripcion } from '../ia/juntas-fireflies.js';
import type {
  CrmActividadCliente,
  JuntaRag,
  TaskItem,
  UsuarioCrm
} from '../nucleo/contrato.js';
import type { Transcripcion } from '../proveedores/fireflies.js';
import {
  archivarJuntaEnRag,
  type PuertosRag,
  type ResultadoArchivoRag
} from './archivar.js';
import { carpetaDeEmpresa, leerCuentaServicio } from './config.js';
import {
  huellaMarkdown,
  markdownDeJunta,
  nombreMarkdown,
  upsertIndice
} from './markdown.js';
import { actorDe, juntaVisible } from './permisos.js';
import {
  aplicarAsignacion,
  idDeCarpetaDrive,
  resolverJunta,
  type CatalogoJunta
} from './resolver.js';

function empresa(id: string, nombre: string): Empresa {
  return {
    id,
    nombre,
    cuentas: [],
    activa: true,
    orden: 0,
    actualizadoEn: '2026-01-01T00:00:00.000Z'
  };
}

const catalogo: CatalogoJunta = {
  empresas: [
    empresa('dealer-solutions', 'Dealer Solutions'),
    empresa('itech-dev', 'Itech Dev')
  ],
  clientes: [{ id: 'cli-norte', nombre: 'Taller Norte' }],
  contactos: [
    {
      clienteId: 'cli-norte',
      correo: 'ana@tallernorte.example',
      nombre: 'Ana Solís'
    }
  ],
  proyectos: [
    {
      id: 'proy-portal',
      clienteId: 'cli-norte',
      nombre: 'Portal de citas',
      empresaAtiendeId: 'dealer-solutions',
      driveUrl: 'https://drive.google.com/drive/folders/carpetaProyectoFicticia'
    },
    {
      id: 'proy-ref',
      clienteId: 'cli-norte',
      nombre: 'App de refacciones',
      empresaAtiendeId: 'dealer-solutions'
    }
  ]
};

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

interface Mundo {
  puertos: PuertosRag;
  juntas: JuntaRag[];
  actividades: CrmActividadCliente[];
  pendientes: TaskItem[];
  borrados: string[];
  carpetas: { padre: string; nombre: string }[];
  subidas: number;
  actualizaciones: number;
  indiceEditable: boolean;
}

function mundo(opts?: {
  verificar?: () => Promise<void>;
  buscar?: PuertosRag['buscar'];
}): Mundo {
  const juntas: JuntaRag[] = [];
  const actividades: CrmActividadCliente[] = [];
  const pendientes: TaskItem[] = [];
  const borrados: string[] = [];
  const carpetas: { padre: string; nombre: string }[] = [];
  const estado = { subidas: 0, actualizaciones: 0, indiceEditable: true };
  const puertos: PuertosRag = {
    carpeta: async (padre, nombre) => {
      carpetas.push({ padre, nombre });
      return `id-${nombre}`;
    },
    buscar: opts?.buscar ?? (async () => undefined),
    subir: async (carpetaId, _nombre, _texto, id) => {
      estado.subidas += 1;
      return {
        id: `file-${id}`,
        url: `https://drive.example/${id}`,
        parents: [carpetaId]
      };
    },
    actualizar: async (fileId, carpetaId) => {
      estado.actualizaciones += 1;
      return {
        id: fileId,
        url: `https://drive.example/${fileId}`,
        parents: [carpetaId]
      };
    },
    verificar: opts?.verificar ?? (async () => undefined),
    indiceLeer: async () => ({
      editable: estado.indiceEditable,
      texto: ''
    }),
    indiceGuardar: async () => undefined,
    juntas: () => juntas,
    guardarJunta: async (j) => {
      const i = juntas.findIndex((x) => x.id === j.id);
      if (i >= 0) {
        juntas[i] = j;
      } else {
        juntas.push(j);
      }
    },
    actividades: () => actividades,
    guardarActividades: async (lista) => {
      actividades.splice(0, actividades.length, ...lista);
    },
    pendientes: () => pendientes,
    guardarPendientes: async (lista) => {
      pendientes.splice(0, pendientes.length, ...lista);
    },
    borrarFireflies: async (id) => {
      borrados.push(id);
    },
    ahora: () => new Date('2026-10-12T20:00:00.000Z')
  };
  return {
    puertos,
    juntas,
    actividades,
    pendientes,
    borrados,
    carpetas,
    get subidas() {
      return estado.subidas;
    },
    get actualizaciones() {
      return estado.actualizaciones;
    },
    get indiceEditable() {
      return estado.indiceEditable;
    },
    set indiceEditable(valor: boolean) {
      estado.indiceEditable = valor;
    }
  };
}

const carpetas = [
  { empresaId: 'dealer-solutions', carpetaId: 'carp-dealer' },
  { empresaId: 'itech-dev', carpetaId: 'carp-itech' }
];

describe('resolver de juntas', () => {
  it('empareja por correo y por el nombre del proyecto', () => {
    const r = resolverJunta(
      transcripcion({
        id: 'ff1',
        titulo: 'Revisión del Portal de citas',
        participantes: ['ana@tallernorte.example']
      }),
      catalogo
    );
    assert.equal(r.estado, 'resuelta');
    if (r.estado === 'resuelta' && !r.esItech) {
      assert.equal(r.clienteId, 'cli-norte');
      assert.equal(r.proyectoId, 'proy-portal');
      assert.equal(r.carpetaProyectoId, 'carpetaProyectoFicticia');
    }
  });

  it('deja la junta en la bandeja si hay varios proyectos', () => {
    const r = resolverJunta(
      transcripcion({
        id: 'ff2',
        titulo: 'Seguimiento semanal',
        participantes: ['ana@tallernorte.example']
      }),
      catalogo
    );
    assert.equal(r.estado, 'sin_asignar');
    if (r.estado === 'sin_asignar') {
      assert.equal(r.esItech, false);
      assert.match(r.motivo, /varios proyectos/);
    }
  });

  it('Itech por correo no usa el CRM aunque haya un contacto', () => {
    const r = resolverJunta(
      transcripcion({
        id: 'ff3',
        titulo: 'Portal de citas con Taller Norte',
        participantes: ['climon@itechdev.com.mx', 'ana@tallernorte.example']
      }),
      catalogo
    );
    assert.equal(r.estado, 'sin_asignar');
    if (r.estado === 'sin_asignar') {
      assert.equal(r.esItech, true);
      assert.equal(r.empresaId, 'itech-dev');
    }
  });

  it('Itech reusa un alias de carpeta ya asignado', () => {
    const r = resolverJunta(
      transcripcion({
        id: 'ff4',
        titulo: 'Avance Sitio interno',
        participantes: ['climon@itechdev.com.mx'],
        resumen: 'El cliente Taller Sur pidió el sitio.'
      }),
      catalogo,
      [{ clienteNombre: 'Taller Sur', proyectoNombre: 'Sitio interno' }]
    );
    assert.equal(r.estado, 'resuelta');
    if (r.estado === 'resuelta' && r.esItech) {
      assert.equal(r.clienteNombre, 'Taller Sur');
      assert.equal(r.proyectoNombre, 'Sitio interno');
    }
  });

  it('la asignación manual de Itech pide nombres y no ids de CRM', () => {
    const t = transcripcion({
      id: 'ff5',
      titulo: 'Junta interna',
      participantes: ['climon@itechdev.com.mx']
    });
    const mala = aplicarAsignacion(
      t,
      { clienteId: 'cli-norte', proyectoId: 'proy-portal' },
      catalogo
    );
    assert.equal(mala.estado, 'sin_asignar');
    const buena = aplicarAsignacion(
      t,
      { clienteNombre: 'Taller Sur', proyectoNombre: 'Sitio interno' },
      catalogo
    );
    assert.equal(buena.estado, 'resuelta');
    if (buena.estado === 'resuelta') {
      assert.equal(buena.esItech, true);
    }
  });

  it('lee el id de una carpeta de Drive', () => {
    assert.equal(
      idDeCarpetaDrive(
        'https://drive.google.com/drive/folders/abc123abc123abc123'
      ),
      'abc123abc123abc123'
    );
  });
});

describe('markdown del RAG', () => {
  it('incluye metadatos, acuerdos y la frase con hablante', () => {
    const t = transcripcion({
      id: 'ff9',
      titulo: 'Revisión del portal',
      url: 'https://app.fireflies.ai/view/ff9',
      resumen: 'Se revisó el avance.',
      acuerdos: '**Ana Solís**\nEnviar el cronograma (01:02)',
      participantes: ['ana@tallernorte.example'],
      frases: [{ texto: 'Vamos con el cronograma.', hablante: 'Ana Solís' }]
    });
    const md = markdownDeJunta(t, {
      cliente: 'Taller Norte',
      proyecto: 'Portal de citas',
      empresa: 'Dealer Solutions'
    });
    assert.match(md, /cliente: Taller Norte/);
    assert.match(md, /proyecto: Portal de citas/);
    assert.match(md, /fireflies: https:\/\/app.fireflies.ai\/view\/ff9/);
    assert.match(md, /Enviar el cronograma \(Ana Solís\)/);
    assert.match(md, /\*\*Ana Solís:\*\* Vamos con el cronograma\./);
    assert.equal(nombreMarkdown(t), '2026-10-12_revision_del_portal.md');
    const indice = upsertIndice('', {
      id: 'ff9',
      fecha: t.fecha,
      cliente: 'Taller Norte',
      proyecto: 'Portal de citas',
      titulo: t.titulo,
      url: 'https://drive.example/ff9'
    });
    const otra = upsertIndice(indice, {
      id: 'ff9',
      fecha: t.fecha,
      cliente: 'Taller Norte',
      proyecto: 'Portal de citas',
      titulo: 'Título nuevo',
      url: 'https://drive.example/ff9'
    });
    assert.equal(otra.split('<!-- ff:ff9 -->').length, 2);
    assert.match(otra, /Título nuevo/);
    assert.equal(huellaMarkdown(md), huellaMarkdown(md));
  });
});

describe('archivado en el RAG', () => {
  const t = transcripcion({
    id: 'ff1',
    titulo: 'Revisión del Portal de citas',
    participantes: ['ana@tallernorte.example'],
    resumen: 'Avance del portal.',
    acuerdos: '**Ana Solís**\nEnviar el cronograma (01:02)',
    url: 'https://app.fireflies.ai/view/ff1',
    frases: [{ texto: 'Quedó el cronograma.', hablante: 'Ana Solís' }]
  });

  async function archivar(
    m: Mundo,
    extra?: {
      borrar?: boolean;
      asignacion?: { clienteNombre: string; proyectoNombre: string };
    }
  ): Promise<ResultadoArchivoRag> {
    return archivarJuntaEnRag(
      extra?.asignacion
        ? transcripcion({
            id: 'ff-itech',
            titulo: 'Junta interna',
            participantes: ['climon@itechdev.com.mx'],
            acuerdos: '**Ana Solís**\nPreparar el entorno (02:00)',
            frases: [{ texto: 'Lo preparo.', hablante: 'Ana Solís' }]
          })
        : t,
      {
        catalogo,
        carpetas,
        borrar: extra?.borrar ?? false,
        driveConfigurado: true,
        asignacion: extra?.asignacion
      },
      m.puertos
    );
  }

  it('guarda en la carpeta del proyecto, anota la actividad y liga el pendiente', async () => {
    const m = mundo();
    m.pendientes.push({
      id: 'fireflies-ff1',
      title: 'Junta: Revisión del Portal de citas',
      status: 'pendiente',
      priority: 'media',
      accountId: 'mios',
      origin: 'local',
      project: 'Revisión del Portal de citas',
      company: 'Dealer Solutions',
      tags: ['junta', 'fireflies'],
      updatedAt: '2026-10-12T18:00:00.000Z',
      subtareas: [{ id: 'sub-1', titulo: 'Enviar el cronograma' }]
    });
    const r = await archivar(m);
    assert.equal(r.estado, 'archivada');
    assert.equal(r.actividad, true);
    assert.equal(r.pendienteLigado, true);
    assert.equal(r.borrada, false);
    assert.equal(r.indice, 'actualizado');
    assert.deepEqual(
      m.carpetas.map((c) => c.nombre),
      ['Juntas']
    );
    assert.equal(m.carpetas[0]?.padre, 'carpetaProyectoFicticia');
    assert.equal(m.actividades[0]?.tipo, 'junta');
    assert.equal(m.actividades[0]?.clienteId, 'cli-norte');
    assert.equal(m.actividades[0]?.proyectoId, 'proy-portal');
    assert.match(m.actividades[0]?.resumen ?? '', /drive\.example\/ff1/);
    assert.equal(m.pendientes[0]?.project, 'Portal de citas');
    assert.equal(m.borrados.length, 0);
    assert.equal(m.juntas[0]?.driveConfirmado, true);
  });

  it('Itech archiva en su carpeta y no toca el CRM ni el proyecto del pendiente', async () => {
    const m = mundo();
    m.pendientes.push({
      id: 'fireflies-ff-itech',
      title: 'Junta: Junta interna',
      status: 'pendiente',
      priority: 'media',
      accountId: 'mios',
      origin: 'local',
      project: 'Junta interna',
      company: 'Itech Dev',
      tags: ['junta', 'fireflies'],
      updatedAt: '2026-10-12T18:00:00.000Z',
      subtareas: [{ id: 'sub-1', titulo: 'Preparar el entorno' }]
    });
    const r = await archivar(m, {
      asignacion: {
        clienteNombre: 'Taller Sur',
        proyectoNombre: 'Sitio interno'
      }
    });
    assert.equal(r.estado, 'archivada');
    assert.equal(r.esItech, true);
    assert.equal(r.actividad, false);
    assert.equal(r.pendienteLigado, false);
    assert.equal(m.actividades.length, 0);
    assert.equal(m.pendientes[0]?.project, 'Junta interna');
    assert.equal(m.pendientes[0]?.company, 'Itech Dev');
    assert.deepEqual(
      m.carpetas.map((c) => `${c.padre}/${c.nombre}`),
      [
        'carp-itech/Taller Sur',
        'id-Taller Sur/02_Proyecto',
        'id-02_Proyecto/Juntas'
      ]
    );
    assert.equal(m.juntas[0]?.clienteId, undefined);
    assert.equal(m.juntas[0]?.proyectoId, undefined);
    assert.equal(m.juntas[0]?.clienteNombre, 'Taller Sur');
  });

  it('no borra de Fireflies si el archivo no se confirma', async () => {
    const m = mundo({
      verificar: async () => {
        throw new Error('el archivo no quedó');
      }
    });
    const r = await archivar(m, { borrar: true });
    assert.equal(r.driveConfirmado, false);
    assert.equal(r.borrada, false);
    assert.equal(m.borrados.length, 0);
    assert.equal(m.actividades.length, 0);
  });

  it('borra solo cuando el Markdown quedó confirmado y el interruptor está prendido', async () => {
    const apagado = mundo();
    const sinBorrar = await archivar(apagado, { borrar: false });
    assert.equal(sinBorrar.driveConfirmado, true);
    assert.equal(apagado.borrados.length, 0);

    const prendido = mundo();
    const conBorrar = await archivar(prendido, { borrar: true });
    assert.equal(conBorrar.borrada, true);
    assert.deepEqual(prendido.borrados, ['ff1']);
  });

  it('si el índice no se puede editar, la junta igual queda archivada', async () => {
    const m = mundo();
    m.indiceEditable = false;
    const r = await archivar(m);
    assert.equal(r.estado, 'archivada');
    assert.equal(r.indice, 'omitido');
  });
});

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
