/**
 * Cache en memoria con vencimiento por llave.
 *
 * Hace falta porque los proveedores ponen limites que el portal, refrescando
 * cada dos minutos y con varias pestañas abiertas, se come rapido: Cursor corta
 * en veinte peticiones por minuto por equipo, y los reportes de uso de Claude
 * no conviene sondearlos mas de una vez por minuto porque sus datos tardan
 * hasta cinco en aparecer.
 *
 * Es en memoria a proposito: si el proceso se reinicia, lo peor que pasa es una
 * consulta de mas. Un cache persistente traeria datos viejos sin que nadie lo
 * note, que es peor.
 */
interface Entrada<T> {
  valor: T;
  venceEn: number;
}

export class Cache {
  private readonly entradas = new Map<string, Entrada<unknown>>();

  /** Vuelos en curso, para que dos peticiones a la vez no peguen dos veces. */
  private readonly enVuelo = new Map<string, Promise<unknown>>();

  constructor(private readonly ahora: () => number = Date.now) {}

  /**
   * Devuelve lo guardado si sigue vigente; si no, corre `producir` una sola vez
   * aunque lleguen varias peticiones al mismo tiempo.
   */
  async obtener<T>(
    llave: string,
    segundos: number,
    producir: () => Promise<T>
  ): Promise<T> {
    const entrada = this.entradas.get(llave);
    if (entrada && entrada.venceEn > this.ahora()) {
      return entrada.valor as T;
    }

    const enCurso = this.enVuelo.get(llave);
    if (enCurso) {
      return enCurso as Promise<T>;
    }

    const promesa = producir()
      .then((valor) => {
        this.entradas.set(llave, {
          valor,
          venceEn: this.ahora() + segundos * 1000
        });
        return valor;
      })
      .finally(() => {
        this.enVuelo.delete(llave);
      });

    this.enVuelo.set(llave, promesa);
    return promesa;
  }

  /** Tira lo guardado. Sin llave, tira todo. */
  olvidar(llave?: string): void {
    if (llave === undefined) {
      this.entradas.clear();
      return;
    }
    this.entradas.delete(llave);
  }

  get tamano(): number {
    return this.entradas.size;
  }
}
