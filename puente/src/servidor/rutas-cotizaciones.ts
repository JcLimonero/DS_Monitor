import type { ClienteIngesta } from '../config/entorno.js';
import type { AlmacenJson } from '../datos/almacen-json.js';
import {
  aplicarSeguimiento,
  esEtapa,
  ETAPAS_CRM,
  indiceActividades,
  llave,
  moverManual,
  sembrar,
  ultimoMovimiento,
  type SeguimientoCrm
} from '../datos/crm-seguimiento.js';
import type { AlmacenIngesta } from '../ingesta/almacen.js';
import { servirRecibido } from '../ingesta/rutas-ingesta.js';
import type {
  CrmActivity,
  CrmOpportunity,
  Person,
  TaskItem
} from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import {
  anotar,
  conEvento,
  type Anotacion,
  type Anotaciones
} from '../pendientes/anotaciones.js';
import {
  AJUSTES_COTIZACIONES_VACIOS,
  buscarVendedor,
  decidir,
  DIAS_POR_OMISION,
  diasVigentes,
  idDePendiente,
  pendienteDeCotizacion,
  validarAjustes,
  type AjustesCotizaciones,
  type CotizacionVigilada
} from '../pendientes/cotizaciones.js';
import type { Contexto, Router } from './router.js';
import type { Programable } from './rutas-ia.js';

/**
 * Cotizaciones que llegan por /ingesta/crm: mover su etapa desde el tablero y
 * el pendiente que se crea cuando una abierta lleva demasiado quieta.
 *
 * El seguimiento (cuando cambio cada etapa, que se movio a mano) vive en
 * `datos/crm-seguimiento.ts`; la decision de crear o cerrar el pendiente, en
 * `pendientes/cotizaciones.ts`. Aqui solo se conectan con las rutas, el reloj
 * y los avisos de asignacion que ya existen.
 */

/** Tope de pendientes nuevos por pasada: un emisor recien conectado no inunda. */
const MAXIMO_NUEVOS_POR_PASADA = 20;

export interface DependenciasCotizaciones {
  router: Router;
  datos: {
    crmSeguimiento: AlmacenJson<SeguimientoCrm>;
    crmAjustes: AlmacenJson<AjustesCotizaciones>;
    personales: AlmacenJson<TaskItem[]>;
    anotaciones: AlmacenJson<Anotaciones>;
  };
  almacen: AlmacenIngesta;
  /** Todos los emisores: los del entorno y los creados desde la aplicacion. */
  emisores: () => ClienteIngesta[];
  /** Lanza 401 si no hay sesion ni token de administracion. */
  exigirAdmin: (contexto: Contexto) => void;
  /** Correo de la sesion, si la hay. */
  correoDeSesion: (contexto: Contexto) => string | undefined;
  equipo: () => Promise<Person[]>;
  /** Correos del dueño del monitor (acceso y buzones). */
  correosDelDueno: () => string[];
  /**
   * Asigna el pendiente a alguien del equipo y le avisa (push y correo, con
   * la regla de no mandar correo al dueño y un aviso por persona y asunto en
   * 24 h).
   */
  asignar: (id: string, quien: string, tarea: TaskItem) => Promise<unknown>;
  programables: Programable[];
}

/** Cada oportunidad ingerida con quien la mando (lo que tiene el snapshot). */
function oportunidadesDe(
  almacen: AlmacenIngesta,
  emisor: ClienteIngesta
): { elementos: CrmOpportunity[]; generadoEn: string } | undefined {
  const snap = almacen.leer<CrmOpportunity>(
    'crm',
    `${emisor.nombre}__oportunidades`
  );
  return snap
    ? { elementos: snap.elementos, generadoEn: snap.generadoEn }
    : undefined;
}

function vencido(generadoEn: string, emisor: ClienteIngesta, ahora: Date) {
  return (
    emisor.vigenciaSegundos > 0 &&
    (ahora.getTime() - Date.parse(generadoEn)) / 1000 > emisor.vigenciaSegundos
  );
}

export function registrarCotizaciones(deps: DependenciasCotizaciones): void {
  const { router, datos, almacen } = deps;

  const emisoresCrm = () =>
    deps.emisores().filter((e) => e.tipos.includes('crm'));

  // --- Lo que lee el portal: las cotizaciones de todos los emisores crm ---
  //
  // Es la conexion "cotizaciones" del portal (path /ops/cotizaciones), igual
  // que /ops/pendientes junta a los emisores de pendientes. Un emisor que dejo
  // de mandar se salta (datos viejos); si ninguno esta al dia, 503.

  const deTodos = <T>(
    recurso: 'oportunidades' | 'actividades',
    transformar: (elementos: T[], emisor: string) => T[]
  ): T[] => {
    const emisores = emisoresCrm();
    const salida: T[] = [];
    let error: unknown;
    let alDia = 0;
    for (const emisor of emisores) {
      try {
        const elementos = servirRecibido(
          almacen,
          emisor,
          'crm',
          `${emisor.nombre}__${recurso}`
        ) as T[];
        salida.push(...transformar(elementos, emisor.nombre));
        alDia++;
      } catch (e) {
        error ??= e;
      }
    }
    if (emisores.length > 0 && alDia === 0) {
      throw error;
    }
    return salida;
  };

  router.get('/ops/cotizaciones/opportunities', async () =>
    deTodos<CrmOpportunity>('oportunidades', (elementos, emisor) =>
      aplicarSeguimiento(elementos, emisor, datos.crmSeguimiento.leer())
    )
  );

  router.get('/ops/cotizaciones/activities', async () =>
    deTodos<CrmActivity>('actividades', (elementos) => elementos)
  );

  // --- Ajustes: dias quieta por etapa ---

  const ajustesVisibles = () => {
    const ajustes = datos.crmAjustes.leer();
    return {
      dias: diasVigentes(ajustes),
      porOmision: DIAS_POR_OMISION,
      actualizadoEn: ajustes.actualizadoEn
    };
  };

  router.get('/crm/seguimiento/ajustes', async () => ajustesVisibles());

  router.post('/crm/seguimiento/ajustes/guardar', async (contexto) => {
    deps.exigirAdmin(contexto);
    try {
      await datos.crmAjustes.escribir(
        validarAjustes(contexto.cuerpo, datos.crmAjustes.leer())
      );
    } catch (error) {
      throw new ErrorPuente((error as Error).message, 400);
    }
    return ajustesVisibles();
  });

  // --- Mover la etapa desde el tablero ---

  router.post('/crm/oportunidades/:id/etapa', async (contexto) => {
    deps.exigirAdmin(contexto);
    let id: string;
    try {
      id = decodeURIComponent(contexto.segmentos[2] ?? '').trim();
    } catch {
      throw new ErrorPuente(
        'El identificador de la oportunidad no es válido.',
        400
      );
    }
    const etapa = (contexto.cuerpo as { etapa?: unknown } | undefined)?.etapa;
    if (!esEtapa(etapa)) {
      throw new ErrorPuente(
        `"etapa" debe ser una de: ${ETAPAS_CRM.join(', ')}.`,
        400
      );
    }
    // La oportunidad tiene que existir y venir de un emisor: las de Odoo se
    // mueven en Odoo. Un id que dos emisores tengan igual no se adivina.
    const encontradas = emisoresCrm().flatMap((emisor) => {
      const opp = oportunidadesDe(almacen, emisor)?.elementos.find(
        (o) => o.id === id
      );
      return opp ? [{ emisor, opp }] : [];
    });
    if (encontradas.length === 0) {
      throw new ErrorPuente(
        'No encontré esa oportunidad entre las que mandan los emisores (las de Odoo se mueven en Odoo).',
        404
      );
    }
    if (encontradas.length > 1) {
      throw new ErrorPuente(
        'Ese identificador lo tienen varios emisores; no sé cuál mover.',
        409
      );
    }
    const { emisor, opp } = encontradas[0] as (typeof encontradas)[number];
    const ahora = new Date();
    const base = sembrar(
      datos.crmSeguimiento.leer(),
      emisor.nombre,
      [opp],
      ahora
    );
    const resultado = moverManual(base, {
      emisor: emisor.nombre,
      id,
      etapa,
      por: deps.correoDeSesion(contexto) ?? 'administración',
      etapaDelEmisor: opp.stage,
      ahora
    });
    if (!resultado.ok) {
      throw new ErrorPuente('No encontré esa oportunidad.', 404);
    }
    if (resultado.seguimiento !== datos.crmSeguimiento.leer()) {
      await datos.crmSeguimiento.escribir(resultado.seguimiento);
    }
    if (!resultado.sinCambio) {
      // Se movio: si tenia un pendiente de vencimiento abierto, ya se atendio.
      await revisar({ soloCerrar: true }).catch((error) =>
        console.warn(`[puente] cotizaciones: ${(error as Error).message}`)
      );
    }
    return aplicarSeguimiento(
      [opp],
      emisor.nombre,
      datos.crmSeguimiento.leer()
    )[0];
  });

  // --- El pendiente de una cotizacion sin movimiento ---

  /** El pendiente tal como lo ve el usuario: abierto, hecho o inexistente. */
  const estadoDe = (id: string): boolean | undefined => {
    const item = datos.personales.leer().find((t) => t.id === id);
    if (!item) {
      return undefined;
    }
    const visto = anotar([item], datos.anotaciones.leer())[0];
    return visto ? visto.status !== 'hecho' : undefined;
  };

  const anotarSistema = async (
    id: string,
    cambio: (nota: Anotacion) => Anotacion
  ) => {
    const todas = datos.anotaciones.leer();
    const ahora = new Date().toISOString();
    const nota = todas[id] ?? { comentarios: [], actualizadoEn: ahora };
    await datos.anotaciones.escribir({
      ...datos.anotaciones.leer(),
      [id]: { ...cambio(nota), actualizadoEn: ahora }
    });
  };

  const cerrar = async (id: string, motivo: string) => {
    const ahora = new Date().toISOString();
    await datos.personales.escribir(
      datos.personales
        .leer()
        .map((t) =>
          t.id === id ? { ...t, status: 'hecho', updatedAt: ahora } : t
        )
    );
    await anotarSistema(id, (nota) =>
      conEvento(
        { ...nota, hecho: true, estado: 'hecho' },
        { at: ahora, by: 'automático', kind: 'estado', text: motivo }
      )
    );
  };

  /** Crea el pendiente, o reabre el mismo si ya estaba hecho. */
  const abrir = async (tarea: TaskItem) => {
    const ahora = new Date().toISOString();
    const actuales = datos.personales.leer();
    const existe = actuales.some((t) => t.id === tarea.id);
    await datos.personales.escribir(
      existe
        ? actuales.map((t) => (t.id === tarea.id ? { ...t, ...tarea } : t))
        : [tarea, ...actuales]
    );
    await anotarSistema(tarea.id, (nota) => {
      // Lo que se marco a mano (hecho, borrado) no aplica a este vencimiento.
      // Tampoco el responsable de la vez anterior: se vuelve a decidir.
      const { eliminado, hecho, estado, asignado, ...resto } = nota;
      void [eliminado, hecho, estado, asignado];
      return conEvento(resto, {
        at: ahora,
        by: 'automático',
        kind: 'estado',
        text: existe
          ? 'Reabierto: la cotización volvió a quedarse sin movimiento'
          : 'Creado: cotización sin movimiento'
      });
    });
  };

  const responsableDe = async (
    cot: CotizacionVigilada,
    tarea: TaskItem
  ): Promise<void> => {
    const equipo = await deps.equipo();
    const dueno = deps.correosDelDueno();
    const vendedor = buscarVendedor(cot.vendedor, equipo);
    const delDueno = equipo.find(
      (p) => p.email && dueno.includes(p.email.trim().toLowerCase())
    );
    const quien = vendedor ?? delDueno;
    if (quien) {
      await deps.asignar(tarea.id, quien.id, tarea);
      return;
    }
    // El dueño no esta en la lista del equipo: se le deja el pendiente sin
    // aviso (ya lo ve en el portal) con su correo como responsable.
    const correo = dueno[0];
    if (correo) {
      const persona: Person = {
        id: correo,
        name: correo.split('@')[0] ?? correo,
        email: correo
      };
      await anotarSistema(tarea.id, (nota) =>
        conEvento(
          { ...nota, asignado: persona },
          {
            by: 'automático',
            kind: 'asignacion',
            text: `Asignado a ${persona.name} · cotización sin movimiento`
          }
        )
      );
    }
  };

  const marcarPendiente = async (
    emisor: string,
    id: string,
    desde: string | undefined
  ) => {
    const seg = datos.crmSeguimiento.leer();
    const k = llave(emisor, id);
    const entrada = seg.oportunidades[k];
    if (!entrada) {
      return;
    }
    await datos.crmSeguimiento.escribir({
      ...seg,
      oportunidades: {
        ...seg.oportunidades,
        [k]: { ...entrada, pendienteDesde: desde }
      }
    });
  };

  const revisar = async (opciones: {
    ahora?: Date;
    soloCerrar?: boolean;
  }): Promise<{ creados: number; cerrados: number }> => {
    const ahora = opciones.ahora ?? new Date();
    const ajustes = datos.crmAjustes.leer();
    let creados = 0;
    let cerrados = 0;

    for (const emisor of emisoresCrm()) {
      const recibido = oportunidadesDe(almacen, emisor);
      // Datos viejos: un emisor que dejo de mandar no es una cotizacion quieta.
      if (
        !recibido ||
        (!opciones.soloCerrar && vencido(recibido.generadoEn, emisor, ahora))
      ) {
        continue;
      }
      if (!opciones.soloCerrar) {
        const sembrado = sembrar(
          datos.crmSeguimiento.leer(),
          emisor.nombre,
          recibido.elementos,
          ahora
        );
        if (sembrado !== datos.crmSeguimiento.leer()) {
          await datos.crmSeguimiento.escribir(sembrado);
        }
      }

      for (const opp of recibido.elementos) {
        const seg = datos.crmSeguimiento.leer();
        const entrada = seg.oportunidades[llave(emisor.nombre, opp.id)];
        if (!entrada) {
          continue;
        }
        const servida = aplicarSeguimiento(
          [opp],
          emisor.nombre,
          seg
        )[0] as CrmOpportunity;
        const cot: CotizacionVigilada = {
          emisor: emisor.nombre,
          id: opp.id,
          nombre: opp.name,
          cliente: opp.partner,
          etapa: servida.stage,
          vendedor: opp.salesperson,
          url: opp.url,
          accountId: opp.accountId,
          ultimoMovimiento: ultimoMovimiento(entrada, indiceActividades(seg)),
          pendienteDesde: entrada.pendienteDesde
        };
        const id = idDePendiente(opp.id);
        const decision = decidir(cot, estadoDe(id), ajustes, ahora);

        if (decision.accion === 'cerrar') {
          await cerrar(id, decision.motivo);
          cerrados++;
        } else if (
          decision.accion === 'crear' &&
          !opciones.soloCerrar &&
          creados < MAXIMO_NUEVOS_POR_PASADA
        ) {
          if (estadoDe(id) === true) {
            // Ya estaba abierto (se perdio la marca): solo se registra.
            await marcarPendiente(emisor.nombre, opp.id, cot.ultimoMovimiento);
            continue;
          }
          const tarea = pendienteDeCotizacion(cot, decision.dias, ahora);
          await abrir(tarea);
          await marcarPendiente(emisor.nombre, opp.id, cot.ultimoMovimiento);
          await responsableDe(cot, tarea).catch((error) =>
            console.warn(
              `[puente] cotización "${opp.name}": no se pudo asignar: ${(error as Error).message}`
            )
          );
          creados++;
        }
      }
    }
    return { creados, cerrados };
  };

  deps.programables.push({
    nombre: 'cotizaciones sin movimiento',
    cadaMinutos: 60,
    correr: async () => {
      if (emisoresCrm().length === 0) {
        return 'omitida';
      }
      const { creados, cerrados } = await revisar({});
      if (creados > 0 || cerrados > 0) {
        console.log(
          `[puente] cotizaciones sin movimiento: ${creados} pendiente(s) nuevo(s), ${cerrados} cerrado(s)`
        );
      }
      return;
    }
  });
}
