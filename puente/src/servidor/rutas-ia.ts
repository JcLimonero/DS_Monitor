import { enviarPorEmailJs, type Sesion } from '../acceso/acceso.js';
import { conPrioridadPersonal } from '../pendientes/prioridad.js';
import type { Configuracion, ConfiguracionIa } from '../config/entorno.js';
import {
  ETIQUETA_USO,
  USOS_IA,
  USOS_POR_OMISION,
  limpiarUsos,
  type UsoIa
} from '../ia/usos.js';
import type { Dominio } from '../datos/dominios.js';
import { acuerdosDeJunta, type Acuerdo } from '../ia/acuerdos.js';
import { interpretarDictado, type Propuesta } from '../ia/dictado.js';
import { responderAsistente, type Turno } from '../ia/asistente.js';
import {
  emparejar,
  notasDe,
  transcripcion,
  transcripcionesRecientes
} from '../proveedores/fireflies.js';
import {
  detectarAlertas,
  registrarCostos,
  type Alerta,
  type HistorialCostos
} from '../ia/alertas.js';
import {
  diagnosticar,
  evidenciaDeDespliegue,
  evidenciaDeSitio,
  idDeIncidente,
  type Diagnostico
} from '../ia/diagnostico.js';
import { consumo, type EntradaBitacora } from '../ia/modelo.js';
import {
  aplicarVeredictos,
  clasificarPendientes,
  sugerirResponsable,
  type VeredictoPendiente
} from '../ia/pendientes.js';
import { resumirRepos, semanaIso, type ResumenRepos } from '../ia/repos.js';
import {
  pistasParaModelo,
  type Aprendizajes
} from '../pendientes/aprendido.js';
import { resumirDia, type ResumenDia } from '../ia/resumen.js';
import { borradorDeRespuesta } from '../ia/respuesta.js';
import {
  correoDeSemana,
  redactarAperturas,
  semanaDeCadaQuien,
  type SemanaPersona
} from '../ia/semana.js';
import {
  armarTablero,
  cerradosAyer,
  juntasDelDia,
  paraHoy,
  proximasEntregas,
  vencidos,
  type Fuentes,
  type Tablero
} from '../ia/tablero.js';
import type {
  Deployment,
  LicenseUsage,
  Meeting,
  MonitorTarget,
  Person,
  RepoStatus,
  TaskItem
} from '../nucleo/contrato.js';
import { ErrorConfiguracion, ErrorPuente } from '../nucleo/errores.js';
import type { AlmacenJson } from '../datos/almacen-json.js';
import type { Anotaciones } from '../pendientes/anotaciones.js';
import type { Clasificacion } from '../proveedores/ia.js';
import { huella } from '../proveedores/ia.js';
import { crearLead } from '../proveedores/odoo.js';
import type { Contexto, Router } from './router.js';
import type { NuevaJunta } from '../proveedores/microsoft.js';

/**
 * Las rutas de inteligencia artificial, todas bajo /ia.
 *
 * Cada una hace una sola llamada al modelo y guarda el resultado, de modo que
 * volver a pedirla no cuesta: el resumen del dia se genera una vez por dia,
 * el de repositorios una vez por semana, un diagnostico una vez por
 * incidente, los acuerdos una vez por junta. Sin API key todo responde que
 * la IA no esta activa, y el resto del puente sigue igual.
 */

/** Lo que estas rutas guardan en disco. */
export interface DatosIa {
  iaResumen: AlmacenJson<ResumenDia | null>;
  iaAlertas: AlmacenJson<Record<string, string>>;
  costosHistorial: AlmacenJson<HistorialCostos>;
  iaAcuerdos: AlmacenJson<Record<string, Acuerdo[]>>;
  iaCrm: AlmacenJson<
    Record<
      string,
      { estado: 'creada' | 'descartada'; url?: string; en: string }
    >
  >;
  iaDiagnosticos: AlmacenJson<Record<string, Diagnostico>>;
  iaRepos: AlmacenJson<ResumenRepos | null>;
  iaSemana: AlmacenJson<{
    semana?: string;
    enviadoEn?: string;
    enviados?: string[];
  }>;
  iaPendientes: AlmacenJson<Record<string, VeredictoPendiente>>;
}

/** Lo que `rutas.ts` presta: configuracion, guardas y fuentes. */
export interface DependenciasIa {
  cfg: () => Configuracion;
  datos: DatosIa & {
    iaUsos: AlmacenJson<Record<UsoIa, boolean>>;
    iaBitacora: AlmacenJson<EntradaBitacora[]>;
    anotaciones: AlmacenJson<Anotaciones>;
    iaCorreo: AlmacenJson<Record<string, Clasificacion>>;
    personales: AlmacenJson<TaskItem[]>;
    aprendido: AlmacenJson<Aprendizajes>;
  };
  exigirAdmin: (contexto: Contexto) => void;
  sesionDe: (contexto: Contexto) => Sesion | undefined;
  olvidarCache: () => void;
  fuentes: Fuentes;
  /** Todos los pendientes de correo registrados, para buscar uno por id. */
  pendientesDeCorreo: () => TaskItem[];
  asignar: (
    id: string,
    quien: string,
    tarea: Partial<TaskItem>,
    sesion: Sesion | undefined
  ) => Promise<string | undefined>;
  dominios: () => Dominio[];
  /** Clasificar empresa/prioridad de pendientes de Ops con el modelo (apagado). */
  clasificarPendientesAutomatico?: boolean;
  /** El modelo solo si ese uso esta permitido en Integraciones → IA. */
  iaPara: (uso: UsoIa) => ConfiguracionIa | undefined;
  /** Avisos push, para el arranque del dia. */
  push: {
    avisar: (
      n: { titulo: string; cuerpo: string; url?: string; etiqueta?: string },
      correo?: string
    ) => Promise<unknown>;
  };
  /** La liga personal de alguien del equipo (ve, comenta y marca lo suyo). */
  ligaDe: (persona: Person) => Promise<string>;
  /** Buzones donde se pueden crear juntas (conectados con Microsoft). */
  calendarios: () => { id: string; usuario: string }[];
  /** Los correos del dueño del monitor (acceso y buzones), en minusculas. */
  correosDelDueno: () => string[];
  /** Crea una junta en el calendario del buzon dado (Microsoft). */
  agendar: (
    cuentaId: string,
    junta: NuevaJunta
  ) => Promise<{ id: string; webLink?: string; joinUrl?: string }>;
}

const HORAS_RESUMEN = 6;
const MAXIMO_DIAGNOSTICOS = 60;
const MAXIMO_POR_LOTE = 40;

export interface Programable {
  nombre: string;
  cadaMinutos: number;
  correr: () => Promise<void>;
}

export interface ServiciosIa {
  /** Lo que corre solo, a intervalos. */
  programables: Programable[];
  /** Una pregunta suelta al asistente (el bot de Telegram la usa). */
  preguntar: (texto: string) => Promise<string>;
  /** Pone empresa y prioridad a pendientes que llegan sin ellas. */
  conVeredictos: (tareas: TaskItem[]) => Promise<TaskItem[]>;
}

export function registrarRutasIa(
  router: Router,
  d: DependenciasIa
): ServiciosIa {
  const ia = () => d.cfg().ia;
  const exigirIa = (uso: UsoIa) => {
    if (!ia()) {
      throw new ErrorConfiguracion(
        'La inteligencia artificial no está configurada: captura la API key de OpenRouter en Integraciones → IA.'
      );
    }
    const config = d.iaPara(uso);
    if (!config) {
      throw new ErrorConfiguracion(
        `El uso "${ETIQUETA_USO[uso].titulo}" de la IA está apagado; se prende en Integraciones → IA.`
      );
    }
    return config;
  };

  router.get('/ia/bitacora', async () => {
    const entradas = d.datos.iaBitacora.leer();
    const porUso: Record<
      string,
      { llamadas: number; costo: number; entrada: number; salida: number }
    > = {};
    for (const e of entradas) {
      const u = (porUso[e.uso] ??= {
        llamadas: 0,
        costo: 0,
        entrada: 0,
        salida: 0
      });
      u.llamadas += 1;
      u.costo += e.costo ?? 0;
      u.entrada += e.entrada;
      u.salida += e.salida;
    }
    return { entradas: entradas.slice(0, 100), porUso };
  });

  router.get('/ia/usos', async () => ({
    usos: { ...USOS_POR_OMISION, ...d.datos.iaUsos.leer() },
    catalogo: USOS_IA.map((id) => ({ id, ...ETIQUETA_USO[id] }))
  }));

  router.post('/ia/usos', async (contexto) => {
    d.exigirAdmin(contexto);
    const actual = { ...USOS_POR_OMISION, ...d.datos.iaUsos.leer() };
    return {
      usos: await d.datos.iaUsos.escribir(limpiarUsos(contexto.cuerpo, actual))
    };
  });
  const urlPortal = () => d.cfg().urlPortal;

  router.get('/ia/estado', async () => {
    const config = ia();
    return {
      activa: !!config,
      modelo: config?.modelo,
      consumo,
      // Donde se pueden crear juntas: buzones conectados con Microsoft.
      calendarios: d.calendarios(),
      // Para que la tarjeta sepa que un pendiente es "propio" aunque el
      // responsable sea uno de los buzones y no el correo de la sesion.
      correosDelDueno: d.correosDelDueno(),
      fireflies: !!d.cfg().fireflies,
      telegram: !!d.cfg().telegram,
      usos: { ...USOS_POR_OMISION, ...d.datos.iaUsos.leer() }
    };
  });

  // --- Modelos recomendados que la cuenta tiene disponibles ---
  //
  // OpenRouter filtra por la politica de datos de la cuenta (ZDR), asi que
  // se enseñan solo los que de verdad se pueden usar, con su precio.

  router.get('/ia/modelos', async () => {
    const config = ia();
    if (!config) {
      return { actual: undefined, modelos: [] };
    }
    const RECOMENDADOS: Record<string, string> = {
      'openai/gpt-oss-120b': 'Rápido y barato; buen español',
      'deepseek/deepseek-v4-flash-0731':
        'Misma familia que DeepSeek 4.1, 5× más barato',
      'deepseek/deepseek-v4-flash': 'DeepSeek 4 Flash',
      'deepseek/deepseek-v4.1-flash':
        'DeepSeek 4.1 Flash (más caro, muy capaz)',
      'qwen/qwen3.7-flash': 'Qwen 3.7 Flash (el más barato)',
      'google/gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
      'google/gemini-2.5-flash': 'Gemini 2.5 Flash (también transcribe audio)',
      'anthropic/claude-haiku-4.5':
        'Claude Haiku 4.5 (el más fino de los baratos)',
      'mistralai/mistral-nemo': 'Mistral Nemo (muy barato, más simple)'
    };
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models/user', {
        headers: { authorization: `Bearer ${config.apiKey}` }
      });
      const datos = (await r.json()) as {
        data?: {
          id: string;
          pricing?: { prompt?: string; completion?: string };
        }[];
      };
      const disponibles = new Map((datos.data ?? []).map((m) => [m.id, m]));
      const modelos = Object.entries(RECOMENDADOS)
        .filter(([id]) => disponibles.has(id))
        .map(([id, nota]) => {
          const m = disponibles.get(id);
          return {
            id,
            nota,
            entrada: Number(m?.pricing?.prompt ?? 0) * 1e6,
            salida: Number(m?.pricing?.completion ?? 0) * 1e6
          };
        })
        .sort((a, b) => a.entrada + a.salida - (b.entrada + b.salida));
      return { actual: config.modelo, modelos };
    } catch {
      return { actual: config.modelo, modelos: [] };
    }
  });

  // --- Resumen del dia ---

  const alertasActuales = async (ahora: Date): Promise<Alerta[]> => {
    const [licencias, dominios] = await Promise.all([
      d.fuentes.licencias().catch(() => [] as LicenseUsage[]),
      Promise.resolve(d.dominios())
    ]);
    const historial = registrarCostos(
      d.datos.costosHistorial.leer(),
      licencias,
      ahora
    );
    await d.datos.costosHistorial.escribir(historial);
    const alertas = detectarAlertas(licencias, dominios, historial, ahora);
    // Las alertas salen por reglas; el modelo no se gasta en redactarlas
    // (se conserva lo que ya se hubiera redactado antes).
    const conTexto = d.datos.iaAlertas.leer();
    return alertas.map((a) => ({ ...a, texto: conTexto[a.id] }));
  };

  router.get('/ia/alertas', async () => alertasActuales(new Date()));

  const generarResumen = async (ahora = new Date()): Promise<ResumenDia> => {
    const config = exigirIa('resumen');
    const tablero = await armarTablero(d.fuentes, ahora);
    const alertas = await alertasActuales(ahora);
    const resumen = await resumirDia(config, tablero, alertas, ahora);
    await d.datos.iaResumen.escribir(resumen);
    return resumen;
  };

  const resumenVigente = (ahora: Date): ResumenDia | undefined => {
    const r = d.datos.iaResumen.leer();
    if (!r) {
      return undefined;
    }
    const edadHoras = (ahora.getTime() - Date.parse(r.generadoEn)) / 3_600_000;
    return edadHoras < HORAS_RESUMEN ? r : undefined;
  };

  router.get('/ia/resumen', async () => {
    if (!ia()) {
      return { disponible: false };
    }
    // Solo lo que ya se genero: el modelo se llama cuando alguien lo pide
    // (POST /ia/resumen/generar), no en cada carga.
    return { disponible: true, resumen: d.datos.iaResumen.leer() ?? undefined };
  });

  router.post('/ia/resumen/generar', async (contexto) => {
    d.exigirAdmin(contexto);
    return { disponible: true, resumen: await generarResumen() };
  });

  // --- Acuerdos de una junta ---

  router.post('/ia/acuerdos', async (contexto) => {
    d.exigirAdmin(contexto);
    const config = exigirIa('juntas');
    let { junta } = (contexto.cuerpo ?? {}) as { junta?: Meeting };
    if (
      !junta ||
      typeof junta.id !== 'string' ||
      typeof junta.title !== 'string'
    ) {
      throw new ErrorPuente('Falta la junta.', 400);
    }
    // Con Fireflies, las notas reales de la junta mandan sobre la descripcion
    // de la invitacion.
    let fuente: 'fireflies' | 'invitacion' | 'ninguna' = junta.notes
      ? 'invitacion'
      : 'ninguna';
    let urlNotas: string | undefined;
    const fireflies = d.cfg().fireflies;
    if (fireflies) {
      try {
        const lista = await transcripcionesRecientes(fireflies, 45);
        const t = emparejar(junta, lista);
        if (t) {
          const completa = await transcripcion(fireflies, t.id);
          junta = { ...junta, notes: notasDe(completa) };
          fuente = 'fireflies';
          urlNotas = completa.url;
        }
      } catch (error) {
        console.warn(`[puente] Fireflies: ${(error as Error).message}`);
      }
    }
    const clave = `${junta.id}:${huella(junta.notes ?? '')}`;
    const guardados = d.datos.iaAcuerdos.leer();
    if (guardados[clave]) {
      return {
        acuerdos: guardados[clave],
        notas: !!junta.notes,
        fuente,
        urlNotas
      };
    }
    const equipo = await d.fuentes.equipo();
    const acuerdos = await acuerdosDeJunta(config, junta, equipo);
    const recorte = Object.entries(guardados).slice(-200);
    await d.datos.iaAcuerdos.escribir({
      ...Object.fromEntries(recorte),
      [clave]: acuerdos
    });
    return { acuerdos, notas: !!junta.notes, fuente, urlNotas };
  });

  router.post('/ia/acuerdos/aceptar', async (contexto) => {
    d.exigirAdmin(contexto);
    const cuerpo = (contexto.cuerpo ?? {}) as {
      acuerdos?: Acuerdo[];
      junta?: string;
    };
    const acuerdos = Array.isArray(cuerpo.acuerdos) ? cuerpo.acuerdos : [];
    if (acuerdos.length === 0) {
      throw new ErrorPuente('No hay acuerdos que agregar.', 400);
    }
    const ahora = new Date().toISOString();
    const sesion = d.sesionDe(contexto);
    const nuevos: TaskItem[] = acuerdos
      .filter((a) => typeof a.titulo === 'string' && a.titulo.trim())
      .map((a, i) => ({
        id: `local-acuerdo-${Date.now()}-${i}`,
        title: a.titulo.trim().slice(0, 120),
        description: [
          a.descripcion,
          cuerpo.junta ? `Acuerdo de la junta: ${cuerpo.junta}` : undefined
        ]
          .filter((x) => x)
          .join('\n'),
        status: 'pendiente',
        priority: a.prioridad ?? 'media',
        dueDate: a.venceEn,
        accountId: 'mios',
        origin: 'local',
        project: a.empresa ?? 'Acuerdos',
        company: a.empresa,
        tags: ['acuerdo', 'ia'],
        updatedAt: ahora
      }));
    await d.datos.personales.escribir([
      ...d.datos.personales.leer(),
      ...nuevos
    ]);
    const avisos: string[] = [];
    for (const [i, a] of acuerdos.entries()) {
      const tarea = nuevos[i];
      const quien = a.persona?.email ?? a.persona?.id;
      if (tarea && quien) {
        const aviso = await d.asignar(tarea.id, quien, tarea, sesion);
        if (aviso) {
          avisos.push(`${tarea.title}: ${aviso}`);
        }
      }
    }
    d.olvidarCache();
    return { agregados: nuevos.length, avisos };
  });

  // --- Dictado: texto libre → pendientes ---
  //
  // Funciona sin modelo (reglas) y mejor con el. Lo que devuelve son
  // propuestas; guardarlas es otra llamada, con lo que la persona corrigio.

  router.post('/ia/dictado', async (contexto) => {
    d.exigirAdmin(contexto);
    const { texto } = (contexto.cuerpo ?? {}) as { texto?: string };
    if (typeof texto !== 'string' || !texto.trim()) {
      throw new ErrorPuente('Falta el texto dictado.', 400);
    }
    const equipo = await d.fuentes.equipo();
    const propuestas = await interpretarDictado(
      d.iaPara('dictado'),
      texto,
      equipo
    );
    return { propuestas, conIa: !!d.iaPara('dictado') };
  });

  router.post('/ia/dictado/aceptar', async (contexto) => {
    d.exigirAdmin(contexto);
    const { propuestas } = (contexto.cuerpo ?? {}) as {
      propuestas?: Propuesta[];
    };
    const lista = Array.isArray(propuestas) ? propuestas : [];
    if (lista.length === 0) {
      throw new ErrorPuente('No hay nada que agregar.', 400);
    }
    const ahora = new Date().toISOString();
    const sesion = d.sesionDe(contexto);
    const equipo = await d.fuentes.equipo();
    const nuevos: TaskItem[] = lista
      .filter((p) => typeof p.titulo === 'string' && p.titulo.trim())
      .map((p, i) => ({
        id: `local-dictado-${Date.now()}-${i}`,
        title: p.titulo.trim().slice(0, 120),
        description:
          typeof p.descripcion === 'string' && p.descripcion.trim()
            ? p.descripcion.trim()
            : undefined,
        status: 'pendiente',
        priority:
          (['baja', 'media', 'alta', 'urgente'] as const).find(
            (x) => x === p.prioridad
          ) ?? 'media',
        dueDate:
          typeof p.venceEn === 'string' && !Number.isNaN(Date.parse(p.venceEn))
            ? p.venceEn
            : undefined,
        dueHasTime: p.conHora === true ? true : undefined,
        accountId: 'mios',
        origin: 'local',
        project:
          typeof p.proyecto === 'string' && p.proyecto.trim()
            ? p.proyecto.trim()
            : undefined,
        company: p.personal
          ? undefined
          : (typeof p.empresa === 'string' && p.empresa) || undefined,
        personal: p.personal === true ? true : undefined,
        tags: ['dictado'],
        updatedAt: ahora
      }));
    await d.datos.personales.escribir([
      ...nuevos.map(conPrioridadPersonal),
      ...d.datos.personales.leer()
    ]);
    const avisos: string[] = [];
    for (const [i, p] of lista.entries()) {
      const tarea = nuevos[i];
      const quien =
        p.persona?.email ??
        p.persona?.id ??
        (typeof p.responsable === 'string'
          ? equipo.find(
              (e) => e.name.toLowerCase() === p.responsable?.toLowerCase()
            )?.id
          : undefined);
      if (tarea && quien) {
        try {
          const aviso = await d.asignar(tarea.id, quien, tarea, sesion);
          if (aviso) {
            avisos.push(`${tarea.title}: ${aviso}`);
          }
        } catch (error) {
          avisos.push(`${tarea.title}: ${(error as Error).message}`);
        }
      }
    }
    // Lo que se pidio agendar se crea en el calendario de la cuenta dicha.
    for (const [i, p] of lista.entries()) {
      const tarea = nuevos[i];
      const cuenta = typeof p.agendarEn === 'string' ? p.agendarEn : undefined;
      if (!tarea || !cuenta || !tarea.dueDate) {
        continue;
      }
      try {
        const r = await d.agendar(cuenta, {
          titulo: tarea.title,
          inicio: tarea.dueDate,
          fin: new Date(Date.parse(tarea.dueDate) + 3_600_000).toISOString(),
          lugar: typeof p.lugar === 'string' ? p.lugar : undefined,
          cuerpo: tarea.description,
          invitados: p.persona?.email ? [p.persona.email] : []
        });
        avisos.push(
          `${tarea.title}: agendada en ${cuenta}${r.joinUrl ? ' (Teams)' : ''}.`
        );
      } catch (error) {
        avisos.push(
          `${tarea.title}: no se pudo agendar: ${(error as Error).message}`
        );
      }
    }
    d.olvidarCache();
    return { agregados: nuevos.length, avisos };
  });

  // --- La ventana de la IA ---

  router.post('/ia/preguntar', async (contexto) => {
    d.exigirAdmin(contexto);
    const config = exigirIa('asistente');
    const { conversacion } = (contexto.cuerpo ?? {}) as {
      conversacion?: Turno[];
    };
    const turnos = (Array.isArray(conversacion) ? conversacion : [])
      .filter(
        (t) =>
          t &&
          (t.rol === 'usuario' || t.rol === 'asistente') &&
          typeof t.texto === 'string'
      )
      .slice(-12);
    if (turnos.length === 0) {
      throw new ErrorPuente('Falta la pregunta.', 400);
    }
    const ahora = new Date();
    const tablero = await armarTablero(d.fuentes, ahora);
    const alertas = await alertasActuales(ahora);
    const respuesta = await responderAsistente(
      config,
      tablero,
      alertas,
      turnos,
      ahora
    );
    return { respuesta };
  });

  // --- Borrador de respuesta a un correo ---

  router.post('/ia/respuesta', async (contexto) => {
    d.exigirAdmin(contexto);
    const config = exigirIa('respuestas');
    const { id, instrucciones, correo } = (contexto.cuerpo ?? {}) as {
      id?: string;
      instrucciones?: string;
      /** Un correo pegado tal cual, cuando no viene de un pendiente. */
      correo?: string;
    };
    const tarea =
      typeof correo === 'string' && correo.trim()
        ? {
            id: 'libre',
            title: /^Asunto: (.+)$/m.exec(correo)?.[1]?.trim() ?? 'Correo',
            description: correo.trim().slice(0, 8000),
            status: 'pendiente' as const,
            priority: 'media' as const,
            accountId: 'mios',
            origin: 'correo' as const,
            tags: [],
            updatedAt: new Date().toISOString()
          }
        : d.pendientesDeCorreo().find((t) => t.id === id);
    if (!tarea) {
      throw new ErrorPuente(
        'Ese pendiente no viene del correo o ya no está.',
        404
      );
    }
    const sesion = d.sesionDe(contexto);
    const equipo = await d.fuentes.equipo();
    const yo = equipo.find(
      (p) => p.email?.toLowerCase() === sesion?.correo.toLowerCase()
    );
    const firma = yo?.name ?? sesion?.correo ?? 'el equipo';
    return borradorDeRespuesta(config, tarea, firma, instrucciones);
  });

  // --- Sugerencias para el CRM (salen del clasificador de correo) ---

  const sugerenciasCrm = () => {
    const estados = d.datos.iaCrm.leer();
    return Object.values(d.datos.iaCorreo.leer())
      .filter((c) => c.crm && !estados[c.id])
      .sort((a, b) => b.analizadoEn.localeCompare(a.analizadoEn))
      .map((c) => ({
        id: c.id,
        ...(c.crm as NonNullable<Clasificacion['crm']>),
        empresa: c.empresa,
        analizadoEn: c.analizadoEn
      }));
  };

  router.get('/ia/crm/sugerencias', async () => sugerenciasCrm());

  router.post('/ia/crm/sugerencias/crear', async (contexto) => {
    d.exigirAdmin(contexto);
    const { id } = (contexto.cuerpo ?? {}) as { id?: string };
    const s = sugerenciasCrm().find((x) => x.id === id);
    if (!s) {
      throw new ErrorPuente('Esa sugerencia ya no está.', 404);
    }
    const odoo = d.cfg().odoo;
    if (!odoo) {
      throw new ErrorConfiguracion(
        'Para crear en el CRM hace falta la conexión con Odoo (CRM → Configuración).'
      );
    }
    const creado = await crearLead(odoo, {
      nombre: s.nombre,
      tipo: s.tipo,
      contacto: s.contacto,
      correo: s.correo,
      descripcion: `${s.resumen}\n\nDetectado por DS Monitor en el correo${s.empresa ? ` (${s.empresa})` : ''}.`
    });
    await d.datos.iaCrm.escribir({
      ...d.datos.iaCrm.leer(),
      [s.id]: {
        estado: 'creada',
        url: creado.url,
        en: new Date().toISOString()
      }
    });
    d.olvidarCache();
    return { ok: true, url: creado.url };
  });

  router.post('/ia/crm/sugerencias/descartar', async (contexto) => {
    d.exigirAdmin(contexto);
    const { id } = (contexto.cuerpo ?? {}) as { id?: string };
    if (!id) {
      throw new ErrorPuente('Falta el id.', 400);
    }
    await d.datos.iaCrm.escribir({
      ...d.datos.iaCrm.leer(),
      [id]: { estado: 'descartada', en: new Date().toISOString() }
    });
    return { ok: true };
  });

  // --- Diagnostico de caidas y despliegues fallidos ---

  const diagnosticos = async (ahora: Date): Promise<Diagnostico[]> => {
    const config = d.iaPara('diagnosticos');
    const [monitoreo, despliegues] = await Promise.all([
      d.fuentes.monitoreo().catch(() => [] as MonitorTarget[]),
      d.fuentes.despliegues().catch(() => [] as Deployment[])
    ]);
    const caidos = monitoreo.filter((m) => m.status === 'caido');
    const fallidos = despliegues.filter(
      (x) =>
        x.state === 'error' &&
        Date.parse(x.createdAt) > ahora.getTime() - 2 * 86_400_000
    );
    const guardados = d.datos.iaDiagnosticos.leer();
    const salida: Diagnostico[] = [];
    let cambio = false;
    const incidentes: {
      clase: 'sitio' | 'despliegue';
      id: string;
      objetivo: string;
      evidencia: () => Promise<string>;
    }[] = [
      ...caidos.map((m) => ({
        clase: 'sitio' as const,
        id: idDeIncidente('sitio', m),
        objetivo: `${m.name} (${m.url})`,
        evidencia: () => evidenciaDeSitio(m)
      })),
      ...fallidos.map((x) => ({
        clase: 'despliegue' as const,
        id: idDeIncidente('despliegue', x),
        objetivo: `${x.project}${x.branch ? ` · ${x.branch}` : ''}${x.commitMessage ? ` · "${x.commitMessage.slice(0, 80)}"` : ''}`,
        evidencia: () => evidenciaDeDespliegue(d.cfg().vercel, x)
      }))
    ];
    for (const inc of incidentes) {
      const previo = guardados[inc.id];
      if (previo) {
        salida.push(previo);
        continue;
      }
      if (!config) {
        continue;
      }
      try {
        const evidencia = await inc.evidencia();
        const diag = await diagnosticar(
          config,
          inc.clase,
          inc.objetivo,
          evidencia,
          inc.id,
          ahora
        );
        guardados[inc.id] = diag;
        salida.push(diag);
        cambio = true;
      } catch (error) {
        console.warn(
          `[puente] sin diagnóstico para ${inc.objetivo}: ${(error as Error).message}`
        );
      }
    }
    if (cambio) {
      const recorte = Object.values(guardados)
        .sort((a, b) => a.generadoEn.localeCompare(b.generadoEn))
        .slice(-MAXIMO_DIAGNOSTICOS);
      await d.datos.iaDiagnosticos.escribir(
        Object.fromEntries(recorte.map((x) => [x.id, x]))
      );
    }
    return salida;
  };

  router.get('/ia/diagnosticos', async () =>
    Object.values(d.datos.iaDiagnosticos.leer()).sort((a, b) =>
      b.generadoEn.localeCompare(a.generadoEn)
    )
  );

  router.post('/ia/diagnosticos/generar', async (contexto) => {
    d.exigirAdmin(contexto);
    exigirIa('diagnosticos');
    return diagnosticos(new Date());
  });

  // --- La semana en los repositorios ---

  const resumenRepos = async (forzar: boolean, ahora = new Date()) => {
    const config = exigirIa('repos');
    const github = d.cfg().github;
    if (!github) {
      throw new ErrorConfiguracion(
        'Falta la conexión con GitHub (Repos → Configuración).'
      );
    }
    const guardado = d.datos.iaRepos.leer();
    if (!forzar && guardado && guardado.semana === semanaIso(ahora)) {
      return guardado;
    }
    const repos = await d.fuentes.repos().catch(() => [] as RepoStatus[]);
    const resumen = await resumirRepos(config, github, repos, ahora);
    await d.datos.iaRepos.escribir(resumen);
    return resumen;
  };

  router.get('/ia/repos', async () => {
    if (!ia()) {
      return { disponible: false };
    }
    return { disponible: true, resumen: d.datos.iaRepos.leer() ?? undefined };
  });

  router.post('/ia/repos/generar', async (contexto) => {
    d.exigirAdmin(contexto);
    return { disponible: true, resumen: await resumenRepos(true) };
  });

  // --- Semana del equipo ---

  const armarSemana = async (
    redactar: boolean,
    ahora = new Date()
  ): Promise<SemanaPersona[]> => {
    const tablero = await armarTablero(d.fuentes, ahora);
    const semanas = semanaDeCadaQuien(
      tablero,
      d.datos.anotaciones.leer(),
      ahora
    );
    return redactar ? redactarAperturas(d.iaPara('semana'), semanas) : semanas;
  };

  const enviarSemana = async (
    solo?: string,
    ahora = new Date()
  ): Promise<{ enviados: string[]; errores: string[] }> => {
    const acceso = d.cfg().acceso;
    if (!acceso) {
      throw new ErrorConfiguracion(
        'Para mandar el correo semanal hace falta el acceso (EmailJS) en Equipo → Configuración.'
      );
    }
    const semanas = (await armarSemana(false, ahora)).filter(
      (s) => !solo || s.persona.email?.toLowerCase() === solo.toLowerCase()
    );
    const enviados: string[] = [];
    const errores: string[] = [];
    for (const s of semanas) {
      try {
        await enviarPorEmailJs(acceso, s.persona.email as string, '', false, {
          titulo: `Tu semana en DS Monitor · ${new Date(ahora).toLocaleDateString('es-MX', { dateStyle: 'long', timeZone: 'America/Mexico_City' })}`,
          html: correoDeSemana(s, await d.ligaDe(s.persona))
        });
        enviados.push(s.persona.email as string);
      } catch (error) {
        errores.push(`${s.persona.email}: ${(error as Error).message}`);
      }
    }
    if (!solo) {
      await d.datos.iaSemana.escribir({
        semana: semanaIso(ahora),
        enviadoEn: ahora.toISOString(),
        enviados
      });
    }
    return { enviados, errores };
  };

  router.get('/ia/semana', async ({ parametros }) => ({
    ultimoEnvio: d.datos.iaSemana.leer(),
    personas: (await armarSemana(parametros.get('redactar') === '1')).map(
      (s) => ({
        persona: s.persona,
        pendientes: s.pendientes.length,
        vencidos: s.vencidos.length,
        juntas: s.juntas.length,
        apertura: s.apertura,
        html: correoDeSemana(s, urlPortal())
      })
    )
  }));

  router.post('/ia/semana/enviar', async (contexto) => {
    d.exigirAdmin(contexto);
    const { solo } = (contexto.cuerpo ?? {}) as { solo?: string };
    return enviarSemana(
      typeof solo === 'string' && solo.trim() ? solo.trim() : undefined
    );
  });

  // --- Empresa y prioridad para pendientes que llegan sin ellas ---
  //
  // No es una ruta: lo usan las rutas que sirven pendientes de Ops y los
  // personales. Se clasifican solo los que no se han visto, hasta 40 por vez.

  const conVeredictos = async (tareas: TaskItem[]): Promise<TaskItem[]> => {
    const config = ia();
    const vistos = d.datos.iaPendientes.leer();
    // Empresa y prioridad de Ops/personales ya no se piden solas al modelo:
    // se usa lo que haya guardado.
    if (config && d.iaPara('pendientes')) {
      const nuevos = tareas
        .filter((t) => !vistos[t.id] && (!t.company || !t.priority))
        .slice(0, MAXIMO_POR_LOTE);
      if (nuevos.length > 0) {
        try {
          const veredictos = await clasificarPendientes(config, nuevos);
          for (const v of veredictos) {
            vistos[v.id] = v;
          }
          const ids = new Set(tareas.map((t) => t.id));
          const limite = Date.now() - 120 * 86_400_000;
          await d.datos.iaPendientes.escribir(
            Object.fromEntries(
              Object.entries(vistos).filter(
                ([id, v]) => ids.has(id) || Date.parse(v.analizadoEn) > limite
              )
            )
          );
        } catch (error) {
          console.warn(
            `[puente] la IA no pudo clasificar pendientes: ${(error as Error).message}`
          );
        }
      }
    }
    return aplicarVeredictos(tareas, vistos);
  };

  // --- Lo que corre solo ---

  const semanaSiToca = async () => {
    const ahora = new Date();
    const local = new Date(
      ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
    );
    const esLunes = local.getDay() === 1;
    const horaOk = local.getHours() >= 8;
    const ultimo = d.datos.iaSemana.leer();
    if (
      !esLunes ||
      !horaOk ||
      ultimo.semana === semanaIso(ahora) ||
      !d.cfg().acceso
    ) {
      return;
    }
    const r = await enviarSemana(undefined, ahora);
    console.log(
      `[puente] correo semanal: ${r.enviados.length} enviados${r.errores.length ? `, ${r.errores.length} con error` : ''}`
    );
  };

  // A las 8 de la mañana, un push con el arranque del dia: lo cerrado ayer,
  // lo de hoy y lo que se entrega pronto. Una vez por dia.
  let ultimoInicio = '';
  const inicioDelDia = async () => {
    const ahora = new Date();
    const local = new Date(
      ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' })
    );
    const dia = local.toISOString().slice(0, 10);
    if (local.getHours() < 8 || ultimoInicio === dia) {
      return;
    }
    ultimoInicio = dia;
    const tablero = await armarTablero(d.fuentes, ahora);
    const ayer = cerradosAyer(tablero.pendientes, ahora).length;
    const hoy = paraHoy(tablero.pendientes, ahora).length;
    const venc = vencidos(tablero.pendientes, ahora).length;
    const juntas = juntasDelDia(tablero.juntas, ahora).length;
    const proximas = proximasEntregas(tablero.pendientes, ahora, 7).length;
    await d.push.avisar({
      titulo: `Buenos días · ${juntas} ${juntas === 1 ? 'junta' : 'juntas'}, ${hoy} para hoy`,
      cuerpo: `Ayer se cerraron ${ayer}. ${venc} vencidos · ${proximas} entregas en la semana.`,
      url: '/hoy',
      etiqueta: 'inicio-dia'
    });
  };

  // A pedido, desde la tarjeta: a quién asignarlo y de qué empresa es. Los
  // parecidos son los que comparten proyecto o empresa y ya tienen dueño.
  router.post('/ia/sugerir', async (contexto) => {
    const config = exigirIa('asistente');
    const { id } = (contexto.cuerpo ?? {}) as { id?: string };
    const tablero = await armarTablero(d.fuentes, new Date());
    const tarea = tablero.pendientes.find((t) => t.id === id);
    if (!tarea) {
      throw new ErrorPuente('No encontré ese pendiente.', 404);
    }
    const parecidos = tablero.pendientes.filter(
      (t) =>
        t.id !== tarea.id &&
        t.assignee &&
        ((tarea.project && t.project === tarea.project) ||
          (tarea.company && t.company === tarea.company))
    );
    const buzonDe = d
      .cfg()
      .correos.find(
        (c) => c.id === tarea.accountId || c.accountId === tarea.accountId
      );
    return sugerirResponsable(
      config,
      tarea,
      tablero.equipo.map((p) => ({
        id: p.id,
        name: p.name,
        role: p.role,
        email: p.email
      })),
      parecidos,
      pistasParaModelo(d.datos.aprendido.leer()),
      buzonDe ? { correo: buzonDe.usuario } : undefined
    );
  });

  const preguntarSuelto = async (texto: string): Promise<string> => {
    const config = exigirIa('asistente');
    const ahora = new Date();
    const tablero = await armarTablero(d.fuentes, ahora);
    const alertas = await alertasActuales(ahora);
    return responderAsistente(
      config,
      tablero,
      alertas,
      [{ rol: 'usuario', texto }],
      ahora
    );
  };

  return {
    preguntar: preguntarSuelto,
    programables: [
      { nombre: 'correo semanal', cadaMinutos: 15, correr: semanaSiToca },
      { nombre: 'inicio del día', cadaMinutos: 15, correr: inicioDelDia }
    ],
    conVeredictos
  };
}
