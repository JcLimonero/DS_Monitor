import { randomBytes } from 'node:crypto';
import type { AlmacenJson } from '../datos/almacen-json.js';
import {
  clavesCoherentes,
  encabezadoVapid,
  generarClaves,
  type ClavesVapid
} from './vapid.js';

/**
 * Avisos push al celular.
 *
 * El navegador se suscribe (con la clave publica VAPID) y manda su
 * `endpoint`; el puente lo guarda con el correo de quien se suscribio. Para
 * avisar, el puente encola la notificacion y le pega al endpoint SIN cuerpo:
 * el service worker despierta, pide a /push/pendientes lo que tenga en cola
 * y lo enseña. Asi no hace falta cifrar el payload (que es lo pesado del
 * Web Push) y el contenido nunca pasa por Google o Apple.
 */
export interface Suscripcion {
  /** Identificador propio, aleatorio; con el el service worker recoge su cola. */
  id: string;
  endpoint: string;
  correo?: string;
  agente?: string;
  creadoEn: string;
  ultimoEnvio?: string;
}

export interface Notificacion {
  titulo: string;
  cuerpo: string;
  /** A donde lleva al tocarla, relativo al portal. */
  url?: string;
  /** Agrupa avisos del mismo tema para que el ultimo reemplace al anterior. */
  etiqueta?: string;
  en: string;
}

export type ColaPush = Record<string, Notificacion[]>;

const MAXIMO_EN_COLA = 20;

export class Push {
  constructor(
    private readonly claves: AlmacenJson<ClavesVapid | null>,
    private readonly suscripciones: AlmacenJson<Suscripcion[]>,
    private readonly cola: AlmacenJson<ColaPush>,
    private readonly contacto: () => string
  ) {}

  /** La clave publica, generando el par la primera vez. */
  async clavePublica(): Promise<string> {
    let claves = this.claves.leer();
    if (!claves || !clavesCoherentes(claves)) {
      claves = generarClaves();
      await this.claves.escribir(claves);
    }
    return claves.publica;
  }

  lista(): Suscripcion[] {
    return this.suscripciones.leer();
  }

  async suscribir(
    endpoint: string,
    correo: string | undefined,
    agente: string | undefined
  ): Promise<Suscripcion> {
    const actuales = this.suscripciones.leer();
    const previa = actuales.find((s) => s.endpoint === endpoint);
    if (previa) {
      const actualizada = {
        ...previa,
        correo: correo ?? previa.correo,
        agente
      };
      await this.suscripciones.escribir(
        actuales.map((s) => (s.id === previa.id ? actualizada : s))
      );
      return actualizada;
    }
    const nueva: Suscripcion = {
      id: randomBytes(16).toString('hex'),
      endpoint,
      correo,
      agente,
      creadoEn: new Date().toISOString()
    };
    await this.suscripciones.escribir([...actuales, nueva]);
    return nueva;
  }

  async olvidar(endpoint: string): Promise<void> {
    const actuales = this.suscripciones.leer();
    const quitar = actuales.filter((s) => s.endpoint === endpoint);
    if (quitar.length === 0) {
      return;
    }
    await this.suscripciones.escribir(
      actuales.filter((s) => s.endpoint !== endpoint)
    );
    const cola = { ...this.cola.leer() };
    for (const s of quitar) {
      delete cola[s.id];
    }
    await this.cola.escribir(cola);
  }

  /** Lo que un dispositivo tiene por enseñar; se vacia al entregarlo. */
  async recoger(endpoint: string): Promise<Notificacion[]> {
    const sub = this.suscripciones.leer().find((s) => s.endpoint === endpoint);
    if (!sub) {
      return [];
    }
    const cola = this.cola.leer();
    const mias = cola[sub.id] ?? [];
    if (mias.length > 0) {
      await this.cola.escribir({ ...cola, [sub.id]: [] });
    }
    return mias;
  }

  /**
   * Avisa a un conjunto de dispositivos: los de un correo, o todos si no se
   * da correo. Devuelve cuantos se tocaron.
   */
  async avisar(
    notificacion: Omit<Notificacion, 'en'>,
    correo?: string
  ): Promise<{ enviados: number; errores: string[] }> {
    const destino = this.suscripciones
      .leer()
      .filter(
        (s) => !correo || s.correo?.toLowerCase() === correo.toLowerCase()
      );
    if (destino.length === 0) {
      return { enviados: 0, errores: [] };
    }
    const completa: Notificacion = {
      ...notificacion,
      en: new Date().toISOString()
    };
    const cola = { ...this.cola.leer() };
    for (const s of destino) {
      const previas = (cola[s.id] ?? []).filter(
        (n) => !notificacion.etiqueta || n.etiqueta !== notificacion.etiqueta
      );
      cola[s.id] = [...previas, completa].slice(-MAXIMO_EN_COLA);
    }
    await this.cola.escribir(cola);

    const claves = this.claves.leer();
    if (!claves) {
      await this.clavePublica();
    }
    const errores: string[] = [];
    let enviados = 0;
    const muertas: string[] = [];
    for (const s of destino) {
      try {
        const respuesta = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            authorization: encabezadoVapid(
              this.claves.leer() as ClavesVapid,
              s.endpoint,
              this.contacto()
            ),
            ttl: '86400',
            urgency: 'high',
            'content-length': '0'
          }
        });
        if (respuesta.status === 404 || respuesta.status === 410) {
          muertas.push(s.endpoint);
        } else if (!respuesta.ok) {
          errores.push(
            `${respuesta.status} ${(await respuesta.text()).slice(0, 120)}`
          );
        } else {
          enviados += 1;
        }
      } catch (error) {
        errores.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (muertas.length > 0) {
      // El navegador desuscribio (o desinstalaron la app): se olvida.
      for (const endpoint of muertas) {
        await this.olvidar(endpoint);
      }
    }
    if (enviados > 0) {
      const ahora = new Date().toISOString();
      await this.suscripciones.escribir(
        this.suscripciones
          .leer()
          .map((s) =>
            destino.some((d) => d.id === s.id)
              ? { ...s, ultimoEnvio: ahora }
              : s
          )
      );
    }
    return { enviados, errores };
  }
}
