import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { leerConfiguracion, type ClienteIngesta } from '../config/entorno.js';
import { PersistenciaArchivos } from '../datos/persistencia.js';
import type { CrmOpportunity, TaskItem } from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import { anotar } from '../pendientes/anotaciones.js';
import { abrirDatos, cargarDatos, construirRutas } from './rutas.js';
import type { Programable } from './rutas-ia.js';

/**
 * Cotizaciones de punta a punta contra un puente aislado: envios por
 * /ingesta/crm, mover la etapa, el canal de cambios con el emisor y el
 * pendiente de vencimiento. Sin red: no hay EmailJS configurado, asi que
 * ningun aviso sale por correo.
 */

const dirs: string[] = [];
after(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

const DIA = 86_400_000;
const haceDias = (n: number) => new Date(Date.now() - n * DIA).toISOString();

const emisor = (nombre: string, tipos = ['crm']): ClienteIngesta => ({
  nombre,
  token: `token-${nombre}`,
  tipos,
  accountId: nombre,
  vigenciaSegundos: 0
});

async function montar(
  emisores: ClienteIngesta[] = [emisor('ana'), emisor('beto')]
) {
  const dir = await mkdtemp(join(tmpdir(), 'puente-cot-'));
  dirs.push(dir);
  const persistencia = new PersistenciaArchivos({
    datos: join(dir, 'datos'),
    ingesta: join(dir, 'ingesta'),
    correo: join(dir, 'correo'),
    integraciones: join(dir, 'integraciones')
  });
  // El dueño es el buzon: asi hay un correo suyo sin configurar EmailJS.
  const config = leerConfiguracion({
    PUENTE_ADMIN_TOKEN: 'prueba',
    CORREO_CUENTAS: 'buzon|imap|imap.example.com|993|dueno@example.com'
  });
  const datos = abrirDatos(persistencia);
  await cargarDatos(datos, persistencia);
  await datos.emisores.escribir(emisores);
  await datos.equipo.escribir([
    { id: 'u1', name: 'Juan Carlos', email: 'jc@example.com' }
  ]);
  const programables: Programable[] = [];
  const router = construirRutas(
    config,
    undefined,
    persistencia,
    undefined,
    undefined,
    undefined,
    datos,
    programables
  );
  const admin = { authorization: 'Bearer prueba' };
  const post = (
    ruta: string,
    cuerpo: unknown,
    enc: Record<string, string> = admin
  ) => router.resolver(ruta, new URLSearchParams(), 'POST', cuerpo, enc);
  const get = (ruta: string, enc: Record<string, string> = {}) =>
    router.resolver(ruta, new URLSearchParams(), 'GET', undefined, enc);
  const comoEmisor = (nombre: string) => ({
    authorization: `Bearer token-${nombre}`
  });

  type Cot = {
    id: string;
    etapa: string;
    nombre?: string;
    vendedor?: string;
    actividad?: string;
  };
  const enviar = (
    nombre: string,
    generadoEn: string,
    cotizaciones: Cot[],
    modo: 'reemplazar' | 'agregar' = 'reemplazar'
  ) =>
    post(
      '/ingesta/crm',
      {
        version: 1,
        modo,
        generadoEn,
        datos: {
          oportunidades: cotizaciones.map((c) => ({
            id: c.id,
            nombre: c.nombre ?? `Cotización ${c.id}`,
            cliente: 'Grupo Delta',
            etapa: c.etapa,
            vendedor: c.vendedor ? { nombre: c.vendedor } : undefined,
            url: `https://cot.example.com/${c.id}`
          })),
          actividades: cotizaciones
            .filter((c) => c.actividad)
            .map((c) => ({
              id: c.actividad,
              resumen: 'Llamar',
              venceEn: generadoEn,
              oportunidadId: c.id
            }))
        }
      },
      comoEmisor(nombre)
    );

  const opps = async (nombre: string) =>
    (await get(`/recibido/${nombre}/opportunities`)) as CrmOpportunity[];
  const mover = (id: string, etapa: string) =>
    post(`/crm/oportunidades/${id}/etapa`, { etapa });
  const tarea = programables.find(
    (p) => p.nombre === 'cotizaciones sin movimiento'
  ) as Programable;
  /** El pendiente como lo ve el usuario (con anotaciones), o undefined. */
  const pendiente = (id: string): TaskItem | undefined =>
    anotar(datos.personales.leer(), datos.anotaciones.leer()).find(
      (t) => t.id === id
    );
  const pendientesDeCotizacion = () =>
    datos.personales.leer().filter((t) => t.id.startsWith('cotizacion-'));

  return {
    datos,
    post,
    get,
    enviar,
    opps,
    mover,
    comoEmisor,
    correr: () => tarea.correr(),
    pendiente,
    pendientesDeCotizacion,
    admin
  };
}

const estado = (o: CrmOpportunity[] | undefined, id: string) =>
  o?.find((x) => x.id === id)?.stage;

describe('cotizaciones: etapas y seguimiento al recibir', () => {
  it('sirve las 6 etapas y marca lo ingerido con su seguimiento', async () => {
    const { enviar, opps } = await montar();
    await enviar('ana', haceDias(2), [
      { id: '1', etapa: 'Generada' },
      { id: '2', etapa: 'Calificada' },
      { id: '3', etapa: 'Cotización enviada' },
      { id: '4', etapa: 'En negociación' },
      { id: '5', etapa: 'Ganada' },
      { id: '6', etapa: 'Perdida' }
    ]);
    const lista = await opps('ana');
    assert.deepEqual(
      lista.map((o) => o.stage),
      ['nuevo', 'calificado', 'propuesta', 'negociacion', 'ganado', 'perdido']
    );
    assert.ok(lista.every((o) => o.ingested === true));
    assert.ok(lista.every((o) => o.id.startsWith('ana-')));
    assert.equal(lista[0]?.stageChangedAt, lista[0]?.lastMovementAt);
    assert.equal(lista[0]?.stageManual, undefined);
  });

  it('un cambio de etapa en el emisor actualiza stageChangedAt; sin cambio, no', async () => {
    const { enviar, opps } = await montar();
    const t0 = haceDias(5);
    const t1 = haceDias(3);
    const t2 = haceDias(1);
    await enviar('ana', t0, [{ id: '1', etapa: 'Generada' }]);
    await enviar('ana', t1, [{ id: '1', etapa: 'Generada' }]);
    assert.equal((await opps('ana'))[0]?.stageChangedAt, t0);
    await enviar('ana', t2, [{ id: '1', etapa: 'Calificada' }]);
    assert.equal((await opps('ana'))[0]?.stageChangedAt, t2);
  });

  it('una actividad nueva ligada cuenta como movimiento', async () => {
    const { enviar, opps } = await montar();
    const t0 = haceDias(5);
    const t1 = haceDias(1);
    await enviar('ana', t0, [{ id: '1', etapa: 'Generada' }]);
    await enviar('ana', t1, [{ id: '1', etapa: 'Generada', actividad: 'a1' }]);
    const o = (await opps('ana'))[0];
    assert.equal(o?.stageChangedAt, t0);
    assert.equal(o?.lastMovementAt, t1);
  });
});

describe('cotizaciones: lo que lee el portal', () => {
  it('/ops/cotizaciones junta a los emisores crm con su seguimiento', async () => {
    const { enviar, mover, get } = await montar();
    await enviar('ana', haceDias(2), [{ id: '1', etapa: 'Generada' }]);
    await enviar('beto', haceDias(2), [
      { id: '1', etapa: 'Ganada', actividad: 'a1' }
    ]);
    await mover('ana-1', 'propuesta');
    const lista = (await get(
      '/ops/cotizaciones/opportunities'
    )) as CrmOpportunity[];
    assert.deepEqual(
      lista.map((o) => [o.id, o.stage, o.ingested, !!o.stageManual]),
      [
        ['ana-1', 'propuesta', true, true],
        ['beto-1', 'ganado', true, false]
      ]
    );
    const acts = (await get('/ops/cotizaciones/activities')) as unknown[];
    assert.equal(acts.length, 1);
  });

  it('sin ningun emisor al dia contesta 503, y /salud enciende la conexion', async () => {
    const viejo = { ...emisor('ana'), vigenciaSegundos: 60 };
    const { enviar, get } = await montar([viejo]);
    await assert.rejects(
      () => get('/ops/cotizaciones/opportunities'),
      (e) => e instanceof ErrorPuente && e.estado === 503
    );
    await enviar('ana', haceDias(2), [{ id: '1', etapa: 'Generada' }]);
    await assert.rejects(
      () => get('/ops/cotizaciones/opportunities'),
      (e) => e instanceof ErrorPuente && e.estado === 503
    );
    const salud = (await get('/salud')) as {
      conexiones: { conexion: string; configurada: boolean }[];
    };
    assert.equal(
      salud.conexiones.find((c) => c.conexion === 'cotizaciones')?.configurada,
      true
    );
  });
});

describe('cotizaciones: mover la etapa desde el tablero', () => {
  it('la etapa manual gana hasta que el emisor confirma', async () => {
    const { enviar, opps, mover, post, get, comoEmisor } = await montar();
    await enviar('ana', haceDias(2), [{ id: '1', etapa: 'Generada' }]);

    const movida = (await mover('ana-1', 'negociacion')) as CrmOpportunity;
    assert.equal(movida.stage, 'negociacion');
    assert.equal(movida.stageManual?.by, 'administración');
    assert.equal(movida.stageManual?.reported, 'nuevo');
    assert.equal(estado(await opps('ana'), 'ana-1'), 'negociacion');

    // El emisor manda OTRA etapa sin haber confirmado: sigue la manual.
    await enviar('ana', haceDias(1), [{ id: '1', etapa: 'Calificada' }]);
    assert.equal(estado(await opps('ana'), 'ana-1'), 'negociacion');

    // Lo ve en su canal con el id que el mismo mando, sin prefijo.
    const { cambios } = (await get('/ingesta/cambios', comoEmisor('ana'))) as {
      cambios: { id: string; etapa: string; por: string; en: string }[];
    };
    assert.equal(cambios.length, 1);
    assert.equal(cambios[0]?.id, '1');
    assert.equal(cambios[0]?.etapa, 'negociacion');
    assert.equal(cambios[0]?.por, 'administración');

    const r = await post(
      '/ingesta/cambios/confirmar',
      { ids: ['1'] },
      comoEmisor('ana')
    );
    assert.deepEqual(r, { confirmados: 1 });

    // Confirmado: manda el emisor.
    const o = (await opps('ana'))[0];
    assert.equal(o?.stage, 'calificado');
    assert.equal(o?.stageManual, undefined);
    const vacio = (await get('/ingesta/cambios', comoEmisor('ana'))) as {
      cambios: unknown[];
    };
    assert.deepEqual(vacio.cambios, []);
  });

  it('valida: sin sesion 401, etapa mala 400, inexistente 404', async () => {
    const { enviar, post } = await montar();
    await enviar('ana', haceDias(1), [{ id: '1', etapa: 'Generada' }]);
    const status = (e: unknown) => (e instanceof ErrorPuente ? e.estado : 0);
    await assert.rejects(
      () => post('/crm/oportunidades/ana-1/etapa', { etapa: 'ganado' }, {}),
      (e) => status(e) === 401
    );
    await assert.rejects(
      () => post('/crm/oportunidades/ana-1/etapa', { etapa: 'Ganada' }),
      (e) => status(e) === 400
    );
    await assert.rejects(
      () => post('/crm/oportunidades/ana-99/etapa', { etapa: 'ganado' }),
      (e) => status(e) === 404
    );
    // Una de Odoo (o cualquier id que no venga de un emisor) no se mueve aqui.
    await assert.rejects(
      () => post('/crm/oportunidades/odoo-1/etapa', { etapa: 'ganado' }),
      (e) => status(e) === 404
    );
  });

  it('pedir la etapa que ya se ve no crea un cambio para el emisor', async () => {
    const { enviar, mover, get, comoEmisor } = await montar();
    await enviar('ana', haceDias(1), [{ id: '1', etapa: 'Generada' }]);
    await mover('ana-1', 'nuevo');
    const { cambios } = (await get('/ingesta/cambios', comoEmisor('ana'))) as {
      cambios: unknown[];
    };
    assert.equal(cambios.length, 0);
  });
});

describe('cotizaciones: aislamiento entre emisores', () => {
  it('cada token ve solo sus cambios y no confirma los de otro', async () => {
    const { enviar, mover, get, post, comoEmisor, opps } = await montar();
    // Los dos emisores tienen un "1": ana-1 y beto-1.
    await enviar('ana', haceDias(1), [{ id: '1', etapa: 'Generada' }]);
    await enviar('beto', haceDias(1), [{ id: '1', etapa: 'Generada' }]);
    await mover('ana-1', 'ganado');
    await mover('beto-1', 'perdido');

    const de = async (n: string) =>
      (
        (await get('/ingesta/cambios', comoEmisor(n))) as {
          cambios: { id: string; etapa: string; en: string }[];
        }
      ).cambios;
    assert.deepEqual(await de('ana'), [
      {
        id: '1',
        etapa: 'ganado',
        por: 'administración',
        en: (await de('ana'))[0]?.en
      }
    ]);
    assert.equal((await de('beto'))[0]?.etapa, 'perdido');

    // ana intenta confirmar con el id ya prefijado de beto, otro inventado y
    // el suyo: solo cuenta el suyo, y la respuesta no distingue los demas.
    const r = (await post(
      '/ingesta/cambios/confirmar',
      { ids: ['beto-1', 'no-existe', '1'] },
      comoEmisor('ana')
    )) as { confirmados: number };
    assert.equal(r.confirmados, 1);
    assert.equal((await de('ana')).length, 0);
    assert.equal((await de('beto')).length, 1);
    assert.equal(estado(await opps('beto'), 'beto-1'), 'perdido');

    // Confirmar de nuevo lo de ana no toca lo de beto.
    const otra = (await post(
      '/ingesta/cambios/confirmar',
      { ids: ['1'] },
      comoEmisor('ana')
    )) as { confirmados: number };
    assert.equal(otra.confirmados, 0);
    assert.equal((await de('beto')).length, 1);
  });

  it('sin token o con uno sin tipo crm no hay acceso', async () => {
    const { get, post } = await montar([
      emisor('ana'),
      emisor('solo-tareas', ['pendientes'])
    ]);
    const status = (e: unknown) => (e instanceof ErrorPuente ? e.estado : 0);
    await assert.rejects(
      () => get('/ingesta/cambios'),
      (e) => status(e) === 401
    );
    await assert.rejects(
      () => get('/ingesta/cambios', { authorization: 'Bearer malo' }),
      (e) => status(e) === 401
    );
    await assert.rejects(
      () =>
        get('/ingesta/cambios', { authorization: 'Bearer token-solo-tareas' }),
      (e) => status(e) === 403
    );
    await assert.rejects(
      () =>
        post(
          '/ingesta/cambios/confirmar',
          { ids: ['1'] },
          { authorization: 'Bearer token-solo-tareas' }
        ),
      (e) => status(e) === 403
    );
    // El token de administracion no es un token de emisor.
    await assert.rejects(
      () => get('/ingesta/cambios', { authorization: 'Bearer prueba' }),
      (e) => status(e) === 401
    );
  });

  it('el emisor sale del token: un cuerpo con otro emisor no sirve', async () => {
    const { enviar, mover, post, get, comoEmisor } = await montar();
    await enviar('beto', haceDias(1), [{ id: '1', etapa: 'Generada' }]);
    await mover('beto-1', 'ganado');
    const r = (await post(
      '/ingesta/cambios/confirmar',
      { ids: ['1'], emisor: 'beto', origen: 'beto' },
      comoEmisor('ana')
    )) as { confirmados: number };
    assert.equal(r.confirmados, 0);
    const { cambios } = (await get('/ingesta/cambios', comoEmisor('beto'))) as {
      cambios: unknown[];
    };
    assert.equal(cambios.length, 1);
  });

  it('si dos emisores arman el mismo id con prefijo, no se mueve ninguno a ciegas', async () => {
    // "a" + "b-c" y "a-b" + "c" dan los dos "a-b-c".
    const { enviar, post, get, comoEmisor } = await montar([
      emisor('a'),
      emisor('a-b')
    ]);
    await enviar('a', haceDias(1), [{ id: 'b-c', etapa: 'Generada' }]);
    await enviar('a-b', haceDias(1), [{ id: 'c', etapa: 'Generada' }]);
    await assert.rejects(
      () => post('/crm/oportunidades/a-b-c/etapa', { etapa: 'ganado' }),
      (e) => e instanceof ErrorPuente && e.estado === 409
    );
    for (const n of ['a', 'a-b']) {
      const { cambios } = (await get('/ingesta/cambios', comoEmisor(n))) as {
        cambios: unknown[];
      };
      assert.equal(cambios.length, 0);
    }
  });

  it('un reenvio de otro emisor no pisa lo movido a mano', async () => {
    const { enviar, mover, opps } = await montar();
    await enviar('ana', haceDias(2), [{ id: '1', etapa: 'Generada' }]);
    await mover('ana-1', 'propuesta');
    await enviar('beto', haceDias(1), [{ id: '1', etapa: 'Ganada' }]);
    assert.equal(estado(await opps('ana'), 'ana-1'), 'propuesta');
    assert.equal(estado(await opps('beto'), 'beto-1'), 'ganado');
  });
});

describe('cotizaciones: pendiente por falta de movimiento', () => {
  it('crea UN pendiente por cotizacion vencida y no repite', async () => {
    const { enviar, correr, pendientesDeCotizacion, pendiente } =
      await montar();
    await enviar('ana', haceDias(10), [
      {
        id: '1',
        etapa: 'Generada',
        nombre: 'Licencias',
        vendedor: 'Juan Carlos'
      },
      { id: '2', etapa: 'En negociación' },
      { id: '3', etapa: 'Cotización enviada' }
    ]);
    await correr();
    await correr();
    await correr();
    assert.deepEqual(
      pendientesDeCotizacion()
        .map((t) => t.id)
        .sort(),
      ['cotizacion-ana-1', 'cotizacion-ana-2', 'cotizacion-ana-3']
    );
    const t = pendiente('cotizacion-ana-1');
    assert.equal(
      t?.title,
      'Revisar cotización Licencias (Grupo Delta): lleva 10 días en nuevo'
    );
    assert.equal(t?.url, 'https://cot.example.com/1');
    assert.equal(t?.status, 'pendiente');
  });

  it('no crea nada si aun no vence, ni de ganadas o perdidas', async () => {
    const { enviar, correr, pendientesDeCotizacion } = await montar();
    await enviar('ana', haceDias(30), [
      { id: '1', etapa: 'Ganada' },
      { id: '2', etapa: 'Perdida' }
    ]);
    await enviar('beto', haceDias(1), [{ id: '1', etapa: 'En negociación' }]);
    await correr();
    assert.equal(pendientesDeCotizacion().length, 0);
  });

  it('asigna al vendedor si esta en el equipo; si no, al dueño', async () => {
    const { enviar, correr, pendiente } = await montar();
    await enviar('ana', haceDias(10), [
      { id: '1', etapa: 'Generada', vendedor: 'Juan Carlos' },
      { id: '2', etapa: 'Generada', vendedor: 'Alguien Desconocido' },
      { id: '3', etapa: 'Generada' }
    ]);
    await correr();
    assert.equal(pendiente('cotizacion-ana-1')?.assignee?.id, 'u1');
    assert.equal(
      pendiente('cotizacion-ana-2')?.assignee?.email,
      'dueno@example.com'
    );
    assert.equal(
      pendiente('cotizacion-ana-3')?.assignee?.email,
      'dueno@example.com'
    );
  });

  it('se cierra al moverse la cotizacion (desde el tablero o por el emisor)', async () => {
    const { enviar, mover, correr, pendiente } = await montar();
    await enviar('ana', haceDias(10), [
      { id: '1', etapa: 'Generada' },
      { id: '2', etapa: 'Generada' },
      { id: '3', etapa: 'Generada' }
    ]);
    await correr();
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'pendiente');

    // Desde el tablero: se cierra de inmediato, sin esperar la tarea.
    await mover('ana-1', 'calificado');
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'hecho');

    // Por el emisor: se cierra en la siguiente pasada.
    await enviar('ana', haceDias(1), [
      { id: '1', etapa: 'Calificada' },
      { id: '2', etapa: 'Calificada' },
      { id: '3', etapa: 'Ganada' }
    ]);
    await correr();
    assert.equal(pendiente('cotizacion-ana-2')?.status, 'hecho');
    assert.equal(pendiente('cotizacion-ana-3')?.status, 'hecho');
  });

  it('una actividad nueva ligada tambien lo cierra', async () => {
    const { enviar, correr, pendiente } = await montar();
    await enviar('ana', haceDias(10), [{ id: '1', etapa: 'Generada' }]);
    await correr();
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'pendiente');
    await enviar('ana', haceDias(0.01), [
      { id: '1', etapa: 'Generada', actividad: 'a1' }
    ]);
    await correr();
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'hecho');
  });

  it('si se marco hecho a mano, no se recrea hasta un movimiento nuevo y otro vencimiento', async () => {
    const { enviar, correr, post, pendiente, pendientesDeCotizacion } =
      await montar();
    await enviar('ana', haceDias(10), [{ id: '1', etapa: 'Generada' }]);
    await correr();
    await post('/pendientes/anotar', { id: 'cotizacion-ana-1', hecho: true });
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'hecho');

    await correr();
    await correr();
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'hecho');
    assert.equal(pendientesDeCotizacion().length, 1);

    // Se mueve (hace 8 dias) y vuelve a vencer: se reabre el mismo.
    await enviar('ana', haceDias(8), [{ id: '1', etapa: 'Calificada' }]);
    await correr();
    const t = pendiente('cotizacion-ana-1');
    assert.equal(t?.status, 'pendiente');
    assert.match(t?.title ?? '', /lleva 8 días en calificado/);
    assert.equal(pendientesDeCotizacion().length, 1);
  });

  it('si se borro a mano tampoco se recrea hasta un movimiento nuevo', async () => {
    const { enviar, correr, post, pendiente, pendientesDeCotizacion } =
      await montar();
    await enviar('ana', haceDias(10), [{ id: '1', etapa: 'Generada' }]);
    await correr();
    await post('/pendientes/anotar', {
      id: 'cotizacion-ana-1',
      eliminar: true
    });
    assert.equal(pendiente('cotizacion-ana-1'), undefined);
    await correr();
    assert.equal(pendientesDeCotizacion().length, 0);

    await enviar('ana', haceDias(8), [{ id: '1', etapa: 'Calificada' }]);
    await correr();
    assert.equal(pendiente('cotizacion-ana-1')?.status, 'pendiente');
  });

  it('respeta los dias guardados en el ajuste', async () => {
    const { enviar, correr, post, get, pendientesDeCotizacion } =
      await montar();
    await enviar('ana', haceDias(2), [
      { id: '1', etapa: 'Cotización enviada' }
    ]);
    await correr();
    assert.equal(pendientesDeCotizacion().length, 0);
    const a = (await post('/crm/seguimiento/ajustes/guardar', {
      dias: { propuesta: 1 }
    })) as { dias: Record<string, number> };
    assert.equal(a.dias['propuesta'], 1);
    assert.equal(
      (
        (await get('/crm/seguimiento/ajustes')) as {
          dias: Record<string, number>;
        }
      ).dias['propuesta'],
      1
    );
    await correr();
    assert.equal(pendientesDeCotizacion().length, 1);
    await assert.rejects(
      () => post('/crm/seguimiento/ajustes/guardar', { dias: { ganado: 1 } }),
      (e) => e instanceof ErrorPuente && e.estado === 400
    );
    await assert.rejects(
      () =>
        post('/crm/seguimiento/ajustes/guardar', { dias: { nuevo: 1 } }, {}),
      (e) => e instanceof ErrorPuente && e.estado === 401
    );
  });

  it('un emisor que dejo de mandar no genera pendientes', async () => {
    const viejo = { ...emisor('ana'), vigenciaSegundos: 60 };
    const { enviar, correr, pendientesDeCotizacion } = await montar([viejo]);
    await enviar('ana', haceDias(10), [{ id: '1', etapa: 'Generada' }]);
    await correr();
    assert.equal(pendientesDeCotizacion().length, 0);
  });

  it('no inunda: tope de 20 pendientes nuevos por pasada', async () => {
    const { enviar, correr, pendientesDeCotizacion } = await montar();
    await enviar(
      'ana',
      haceDias(10),
      Array.from({ length: 25 }, (_, i) => ({
        id: String(i),
        etapa: 'Generada'
      }))
    );
    await correr();
    assert.equal(pendientesDeCotizacion().length, 20);
    await correr();
    assert.equal(pendientesDeCotizacion().length, 25);
  });

  it('lo anterior al seguimiento empieza a contar desde que se ve', async () => {
    const { datos, enviar, correr, pendientesDeCotizacion } = await montar();
    await enviar('ana', haceDias(10), [{ id: '1', etapa: 'Generada' }]);
    // Como si el envio fuera de antes de que existiera el seguimiento.
    await datos.crmSeguimiento.escribir({ oportunidades: {}, actividades: {} });
    await correr();
    assert.equal(pendientesDeCotizacion().length, 0);
    const [entrada] = Object.values(datos.crmSeguimiento.leer().oportunidades);
    assert.ok(Date.now() - Date.parse(entrada?.cambioEn ?? '') < 60_000);
  });
});
