import type { Persistencia } from './persistencia.js';

/**
 * Una lista o un mapa chico (equipo, dominios, sesiones, anotaciones...) que
 * vive en memoria y se persiste completo cada vez que cambia. Es un
 * documento de la coleccion `datos`, con su clave (`equipo`, `dominios`...).
 */
export class AlmacenJson<T> {
  private valor: T;

  constructor(
    private readonly persistencia: Persistencia,
    readonly clave: string,
    private readonly porOmision: T,
    private readonly coleccion = 'datos'
  ) {
    this.valor = porOmision;
  }

  /** Lee lo guardado; si no hay nada, se queda con lo por omision. */
  async cargar(): Promise<T> {
    const todos = await this.persistencia.leerColeccion(this.coleccion);
    this.valor = todos.has(this.clave)
      ? (todos.get(this.clave) as T)
      : this.porOmision;
    return this.valor;
  }

  /** Igual que cargar, pero con la coleccion ya leida (para no leerla 20 veces). */
  cargarDe(todos: Map<string, unknown>): T {
    this.valor = todos.has(this.clave)
      ? (todos.get(this.clave) as T)
      : this.porOmision;
    return this.valor;
  }

  leer(): T {
    return this.valor;
  }

  async escribir(valor: T): Promise<T> {
    this.valor = valor;
    await this.persistencia.guardar(this.coleccion, this.clave, valor);
    return valor;
  }
}
