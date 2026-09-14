import type { ClienteIngesta, Configuracion } from '../config/entorno.js';
import type { MonitorTarget } from '../nucleo/contrato.js';
import { ErrorPuente } from '../nucleo/errores.js';
import type { Contexto, Router } from '../servidor/router.js';
import { AlmacenIngesta, origenValido } from './almacen.js';
import { TIPOS_INGESTA, type TipoIngesta } from './modelos.js';
import {
  MAXIMO_HISTORIAL,
  normalizarCrm,
  normalizarDespliegues,
  normalizarJuntas,
  normalizarLicencias,
  normalizarPendientes,
  normalizarRepos,
  normalizarRevisiones
} from './normalizar.js';
import { validarSobre } from './validar.js';

/**
 * Las rutas para recibir datos y para devolverlos.
 *
 * Recibir:  POST /ingesta/{tipo}            con Authorization: Bearer <token>
 * Devolver: GET  /recibido/{origen}/{recurso}
 *
 * El origen sale del token, no del cuerpo: asi nadie puede escribir en el
 * buzon de otro cambiando un campo del JSON.
 */

/** Que recurso del portal alimenta cada tipo de envio. */
const RECURSOS_POR_TIPO: Record<TipoIngesta, string[]> = {
  pendientes: ['tasks'],
  juntas: ['meetings'],
  monitoreo: ['targets'],
  crm: ['opportunities', 'activities'],
  licencias: ['licenses'],
  despliegues: ['deployments'],
  repos: ['repos']
};

function autenticar(
  contexto: Contexto,
  clientes: ClienteIngesta[],
  tipo: TipoIngesta
): ClienteIngesta {
  const encabezado = contexto.encabezados['authorization'] ?? '';
  const token = encabezado.toLowerCase().startsWith('bearer ')
    ? encabezado.slice(7).trim()
    : '';

  if (!token) {
    throw new ErrorPuente(
      'Falta el encabezado Authorization: Bearer <token>',
      401
    );
  }

  const cliente = clientes.find((candidato) =>
    seguroIguales(candidato.token, token)
  );
  if (!cliente) {
    // No se dice si el token existe o no: solo que no sirve.
    throw new ErrorPuente('Token no reconocido', 401);
  }

  if (!cliente.tipos.includes(tipo)) {
    throw new ErrorPuente(
      `El emisor "${cliente.nombre}" no tiene permiso para mandar envíos de tipo "${tipo}". Permitidos: ${cliente.tipos.join(', ')}`,
      403
    );
  }

  return cliente;
}

/**
 * Compara sin filtrar cuanto coinciden por el tiempo que tarda.
 *
 * Con `===`, el tiempo de comparacion depende de cuantos caracteres coinciden
 * al principio, y eso alcanza para adivinar un token a base de intentos.
 */
function seguroIguales(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

/**
 * Arma los destinos de monitoreo juntando la revision nueva con el historial.
 *
 * Quien vigila manda solo el resultado de cada revision; el historial y la
 * disponibilidad los lleva el puente, para que el emisor pueda ser un script de
 * tres lineas.
 */
function acumularMonitoreo(
  previos: MonitorTarget[],
  entrantes: ReturnType<typeof normalizarRevisiones>
): MonitorTarget[] {
  const porId = new Map(previos.map((destino) => [destino.id, destino]));

  for (const { destino, revision } of entrantes) {
    const previo = porId.get(destino.id);
    const historial = [...(previo?.history ?? []), revision].slice(
      -MAXIMO_HISTORIAL
    );
    const buenas = historial.filter((chequeo) => chequeo.ok).length;
    const disponibilidad = Math.round((buenas / historial.length) * 1000) / 10;

    porId.set(destino.id, {
      ...destino,
      history: historial,
      uptime24h: disponibilidad,
      // A treinta dias haria falta guardar mucho mas historial; mientras no se
      // guarde, se reporta lo mismo en vez de inventar una cifra.
      uptime30d: disponibilidad
    });
  }

  return [...porId.values()];
}

/** "45 s", "20 min", "3 h". Redondear todo a minutos da mensajes con "0 min". */
export function enPalabras(segundos: number): string {
  if (segundos < 60) {
    return `${segundos} s`;
  }
  if (segundos < 3600) {
    return `${Math.round(segundos / 60)} min`;
  }
  const horas = segundos / 3600;
  return `${horas < 10 ? horas.toFixed(1) : Math.round(horas)} h`;
}

export function registrarRutasIngesta(
  router: Router,
  config: Configuracion,
  almacen: AlmacenIngesta
): void {
  // --- Recibir ---

  for (const tipo of TIPOS_INGESTA) {
    router.post(`/ingesta/${tipo}`, async (contexto) => {
      const cliente = autenticar(contexto, config.clientesIngesta, tipo);
      const { modo, generadoEn, datos } = validarSobre(contexto.cuerpo, tipo);
      const ahora = new Date();

      if (tipo === 'crm') {
        const { oportunidades, actividades } = normalizarCrm(
          datos,
          cliente.nombre,
          cliente.accountId,
          ahora
        );
        const unaCosa = await almacen.guardar(
          'crm',
          `${cliente.nombre}__oportunidades`,
          modo,
          generadoEn,
          oportunidades
        );
        const otraCosa = await almacen.guardar(
          'crm',
          `${cliente.nombre}__actividades`,
          modo,
          generadoEn,
          actividades
        );
        return {
          recibido: unaCosa.guardado || otraCosa.guardado,
          motivo: unaCosa.motivo ?? otraCosa.motivo,
          oportunidades: unaCosa.total,
          actividades: otraCosa.total
        };
      }

      if (tipo === 'monitoreo') {
        const entrantes = normalizarRevisiones(datos, cliente.accountId, ahora);
        const previos =
          almacen.leer<MonitorTarget>('monitoreo', cliente.nombre)?.elementos ??
          [];
        // El monitoreo siempre acumula: cada envio es una revision mas, no el
        // estado completo, asi que reemplazar borraria el historial.
        const destinos = acumularMonitoreo(previos, entrantes);
        const resultado = await almacen.guardar(
          'monitoreo',
          cliente.nombre,
          'reemplazar',
          generadoEn,
          destinos
        );
        return {
          recibido: resultado.guardado,
          motivo: resultado.motivo,
          destinos: resultado.total
        };
      }

      const elementos =
        tipo === 'pendientes'
          ? normalizarPendientes(
              datos,
              cliente.nombre,
              cliente.accountId,
              ahora
            )
          : tipo === 'juntas'
            ? normalizarJuntas(datos, cliente.nombre, cliente.accountId)
            : tipo === 'licencias'
              ? normalizarLicencias(datos, cliente.accountId, ahora)
              : tipo === 'despliegues'
                ? normalizarDespliegues(
                    datos,
                    cliente.nombre,
                    cliente.accountId
                  )
                : normalizarRepos(datos, cliente.accountId, ahora);

      const resultado = await almacen.guardar(
        tipo,
        cliente.nombre,
        modo,
        generadoEn,
        elementos as { id: string }[]
      );

      return {
        recibido: resultado.guardado,
        motivo: resultado.motivo,
        elementos: resultado.total
      };
    });
  }

  // --- Devolver lo recibido ---
  //
  // Se registra una ruta por cada combinacion de origen y recurso que los
  // clientes configurados pueden alimentar. Registrarlas explicitamente hace
  // que la prueba de costura las vea, en lugar de una ruta comodin que
  // aceptaria cualquier cosa y escondería los huecos.
  for (const cliente of config.clientesIngesta) {
    if (!origenValido(cliente.nombre)) {
      console.warn(
        `[puente] el emisor "${cliente.nombre}" tiene un nombre inválido y se ignora; usa letras, números, guion y guion bajo`
      );
      continue;
    }

    for (const tipo of cliente.tipos as TipoIngesta[]) {
      for (const recurso of RECURSOS_POR_TIPO[tipo] ?? []) {
        router.get(`/recibido/${cliente.nombre}/${recurso}`, async () => {
          const origen =
            tipo === 'crm'
              ? `${cliente.nombre}__${recurso === 'opportunities' ? 'oportunidades' : 'actividades'}`
              : cliente.nombre;
          const snapshot = almacen.leer(tipo, origen);

          if (!snapshot) {
            throw new ErrorPuente(
              `Todavía no llega ningún envío de "${cliente.nombre}" para "${tipo}".`,
              503
            );
          }

          const edadSegundos = Math.round(
            (Date.now() - Date.parse(snapshot.generadoEn)) / 1000
          );
          if (
            cliente.vigenciaSegundos > 0 &&
            edadSegundos > cliente.vigenciaSegundos
          ) {
            // Servir datos de hace horas como si fueran de ahora es peor que no
            // servir nada: el portal lo marca como fuente con error y se ve.
            throw new ErrorPuente(
              `El último envío de "${cliente.nombre}" es de hace ${enPalabras(edadSegundos)} y se esperaba uno cada ${enPalabras(cliente.vigenciaSegundos)}.`,
              503
            );
          }

          return snapshot.elementos;
        });
      }
    }
  }

  // --- Diagnostico ---

  router.get('/ingesta/estado', async () => {
    const vigencias = new Map(
      config.clientesIngesta.map((cliente) => [
        cliente.nombre,
        cliente.vigenciaSegundos
      ])
    );
    // Las dos mitades del CRM comparten la vigencia de su emisor.
    for (const cliente of config.clientesIngesta) {
      vigencias.set(
        `${cliente.nombre}__oportunidades`,
        cliente.vigenciaSegundos
      );
      vigencias.set(`${cliente.nombre}__actividades`, cliente.vigenciaSegundos);
    }

    return {
      emisores: config.clientesIngesta.map((cliente) => ({
        nombre: cliente.nombre,
        tipos: cliente.tipos,
        accountId: cliente.accountId,
        vigenciaSegundos: cliente.vigenciaSegundos,
        // El token nunca sale, ni recortado.
        rutas: cliente.tipos.flatMap((tipo) =>
          (RECURSOS_POR_TIPO[tipo as TipoIngesta] ?? []).map(
            (recurso) => `/recibido/${cliente.nombre}/${recurso}`
          )
        )
      })),
      recibido: almacen.estado(vigencias)
    };
  });
}
