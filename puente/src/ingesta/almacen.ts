import type { Persistencia } from '../datos/persistencia.js';
import type { TipoIngesta } from './modelos.js';

/**
 * Lo que se recibio, guardado.
 *
 * Con pull, un reinicio se cura solo en el siguiente ciclo. Con push no: si el
 * puente se reinicia y pierde lo recibido, el portal se queda en blanco hasta
 * que alguien vuelva a mandar, que puede ser en horas. Por eso cada envio se
 * persiste (coleccion `ingesta`, un documento por tipo y origen).
 */

export interface Snapshot<T = unknown> {
  tipo: TipoIngesta;
  origen: string;
  /** Cuando se midio el dato, segun quien lo mando. */
  generadoEn: string;
  /** Cuando llego al puente. */
  recibidoEn: string;
  elementos: T[];
}

/** Lo que el almacen contesta cuando se le pregunta por la frescura. */
export interface EstadoSnapshot {
  tipo: TipoIngesta;
  origen: string;
  generadoEn: string;
  recibidoEn: string;
  elementos: number;
  /** Segundos desde que se genero el dato. */
  edadSegundos: number;
  /** True si ya paso su ventana de frescura. */
  vencido: boolean;
}

function llaveDe(tipo: TipoIngesta, origen: string): string {
  return `${tipo}__${origen}`;
}

/** Solo letras, numeros, guion y guion bajo: esto termina en un nombre de archivo. */
export function origenValido(origen: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,48}$/i.test(origen);
}

export class AlmacenIngesta {
  private readonly snapshots = new Map<string, Snapshot>();

  constructor(
    private readonly persistencia: Persistencia | undefined,
    private readonly ahora: () => Date = () => new Date()
  ) {}

  /** Lee lo guardado en corridas anteriores. */
  async cargar(): Promise<number> {
    if (!this.persistencia) {
      return 0;
    }
    try {
      let cargados = 0;
      for (const valor of (
        await this.persistencia.leerColeccion('ingesta')
      ).values()) {
        const snapshot = valor as Snapshot;
        if (
          snapshot &&
          snapshot.tipo &&
          snapshot.origen &&
          Array.isArray(snapshot.elementos)
        ) {
          this.snapshots.set(llaveDe(snapshot.tipo, snapshot.origen), snapshot);
          cargados++;
        }
      }
      return cargados;
    } catch (error) {
      console.warn('[puente] no se pudo leer lo recibido', error);
      return 0;
    }
  }

  leer<T>(tipo: TipoIngesta, origen: string): Snapshot<T> | undefined {
    return this.snapshots.get(llaveDe(tipo, origen)) as Snapshot<T> | undefined;
  }

  /** Todo lo recibido de un tipo, sin importar el origen. */
  leerTodos<T>(tipo: TipoIngesta): Snapshot<T>[] {
    return [...this.snapshots.values()].filter(
      (snapshot) => snapshot.tipo === tipo
    ) as Snapshot<T>[];
  }

  /**
   * Guarda un envio.
   *
   * Devuelve `false` sin escribir nada si el envio es mas viejo que lo ya
   * guardado. Con reintentos y webhooks los envios llegan fuera de orden mas
   * seguido de lo que uno cree, y dejar que un dato viejo pise a uno nuevo es
   * peor que perder el viejo.
   */
  async guardar<T extends { id: string }>(
    tipo: TipoIngesta,
    origen: string,
    modo: 'reemplazar' | 'agregar',
    generadoEn: string,
    elementos: T[]
  ): Promise<{ guardado: boolean; motivo?: string; total: number }> {
    const llave = llaveDe(tipo, origen);
    const previo = this.snapshots.get(llave) as Snapshot<T> | undefined;

    if (
      previo &&
      new Date(generadoEn).getTime() < new Date(previo.generadoEn).getTime()
    ) {
      return {
        guardado: false,
        motivo: `el envío es anterior al último recibido (${previo.generadoEn}); se ignora para no pisar datos más nuevos`,
        total: previo.elementos.length
      };
    }

    const combinados =
      modo === 'agregar' && previo
        ? mezclarPorId(previo.elementos, elementos)
        : elementos;

    const snapshot: Snapshot<T> = {
      tipo,
      origen,
      generadoEn,
      recibidoEn: this.ahora().toISOString(),
      elementos: combinados
    };

    this.snapshots.set(llave, snapshot as Snapshot);
    await this.escribir(llave, snapshot);

    return { guardado: true, total: combinados.length };
  }

  /** Frescura de todo lo guardado. `vigencias` da la ventana por origen. */
  estado(vigencias: Map<string, number>): EstadoSnapshot[] {
    const ahora = this.ahora().getTime();
    return [...this.snapshots.values()].map((snapshot) => {
      const edadSegundos = Math.max(
        0,
        Math.round((ahora - Date.parse(snapshot.generadoEn)) / 1000)
      );
      const vigencia = vigencias.get(snapshot.origen) ?? 0;
      return {
        tipo: snapshot.tipo,
        origen: snapshot.origen,
        generadoEn: snapshot.generadoEn,
        recibidoEn: snapshot.recibidoEn,
        elementos: snapshot.elementos.length,
        edadSegundos,
        // Vigencia 0 quiere decir que ese origen nunca vence.
        vencido: vigencia > 0 && edadSegundos > vigencia
      };
    });
  }

  private async escribir(llave: string, snapshot: Snapshot): Promise<void> {
    if (!this.persistencia) {
      return;
    }
    try {
      await this.persistencia.guardar('ingesta', llave, snapshot);
    } catch (error) {
      // Que no se pueda escribir no debe tirar el envio: el dato ya esta en
      // memoria y el portal lo va a ver. Solo se pierde si el puente reinicia.
      console.error(`[puente] no se pudo guardar ${llave}`, error);
    }
  }
}

/**
 * Mezcla por identificador: lo nuevo pisa a lo viejo, lo que no venga se queda.
 *
 * El orden respeta el de la lista previa para que la vista no salte de lugar
 * cada vez que llega un evento suelto.
 */
export function mezclarPorId<T extends { id: string }>(
  previos: T[],
  nuevos: T[]
): T[] {
  const porId = new Map(previos.map((elemento) => [elemento.id, elemento]));
  const agregados: T[] = [];

  for (const nuevo of nuevos) {
    if (porId.has(nuevo.id)) {
      porId.set(nuevo.id, nuevo);
    } else {
      agregados.push(nuevo);
    }
  }

  return [...porId.values(), ...agregados];
}
