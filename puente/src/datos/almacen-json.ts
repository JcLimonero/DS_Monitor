import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Un archivo JSON como almacen de una sola cosa: la lista del equipo, la de
 * dominios, las sesiones. Se lee al arrancar y se escribe completo en cada
 * cambio. Para listas de decenas de elementos es lo correcto: una base de
 * datos traeria una dependencia y una migracion para guardar diez renglones.
 */
export class AlmacenJson<T> {
  private valor: T;

  constructor(
    private readonly ruta: string,
    private readonly porOmision: T
  ) {
    this.valor = porOmision;
  }

  async cargar(): Promise<T> {
    try {
      this.valor = JSON.parse(await readFile(this.ruta, 'utf8')) as T;
    } catch {
      this.valor = this.porOmision;
    }
    return this.valor;
  }

  leer(): T {
    return this.valor;
  }

  async escribir(valor: T): Promise<T> {
    this.valor = valor;
    await mkdir(dirname(this.ruta), { recursive: true, mode: 0o700 });
    await writeFile(this.ruta, JSON.stringify(valor, null, 2), { mode: 0o600 });
    return valor;
  }
}
