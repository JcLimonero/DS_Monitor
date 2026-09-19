import { AlmacenJson } from './almacen-json.js';
import type { Fila, Persistencia, Sql } from './persistencia.js';

/**
 * Un almacen con tabla propia en Postgres.
 *
 * Para el resto del puente es un `AlmacenJson`: se lee de memoria y se
 * escribe completo. La diferencia es donde vive: en una tabla con columnas
 * de verdad (y una columna `datos` con el objeto entero, para no perder
 * ningun campo), mas subtablas para lo que son listas dentro del registro
 * (la trazabilidad y los comentarios de un pendiente). Al escribir se
 * comparan las filas con las de la ultima lectura y solo se tocan las que
 * cambiaron, todo en una transaccion.
 *
 * Sin Postgres (archivos en desarrollo) se comporta como un documento mas.
 * La primera vez que arranca con la tabla vacia y el documento existe, lo
 * migra.
 */
export interface Subtabla {
  tabla: string;
  ddl: string;
  /** Columna que apunta al id del registro principal. */
  padre: string;
}

export interface DefinicionTabla<T> {
  /** Clave del documento (por si no hay SQL, y para migrar). */
  clave: string;
  tabla: string;
  ddl: string;
  /** Columna id del registro principal. */
  id: string;
  /** Columnas fijas que distinguen a este almacen dentro de la tabla. */
  filtro?: Record<string, string>;
  /** Columna por la que se leen las filas para conservar el orden de la lista. */
  orden?: string;
  subtablas?: Subtabla[];
  /** Que filas representan el valor. Cada subfila trae la columna `padre`. */
  aFilas(valor: T): { principal: Fila[]; sub: Record<string, Fila[]> };
  deFilas(principal: Fila[], sub: Record<string, Fila[]>): T;
}

export class AlmacenTabla<T> extends AlmacenJson<T> {
  /** Ultimas filas conocidas, por id, para escribir solo la diferencia. */
  private previas = new Map<string, string>();

  constructor(
    private readonly p: Persistencia,
    private readonly def: DefinicionTabla<T>,
    porOmision: T
  ) {
    super(p, def.clave, porOmision);
  }

  private get sql(): Sql | undefined {
    return this.p.sql;
  }

  /** Crea la tabla y sus subtablas si no existen. */
  async preparar(): Promise<void> {
    const sql = this.sql;
    if (!sql) {
      return;
    }
    await sql.ejecutar(this.def.ddl);
    for (const st of this.def.subtablas ?? []) {
      await sql.ejecutar(st.ddl);
    }
  }

  private condicion(desde = 1): { texto: string; valores: string[] } {
    const entradas = Object.entries(this.def.filtro ?? {});
    if (entradas.length === 0) {
      return { texto: '', valores: [] };
    }
    return {
      texto:
        ' WHERE ' +
        entradas.map(([c], i) => `${c} = $${desde + i}`).join(' AND '),
      valores: entradas.map(([, v]) => v)
    };
  }

  override async cargar(): Promise<T> {
    const sql = this.sql;
    if (!sql) {
      return super.cargar();
    }
    await this.preparar();
    const { texto, valores } = this.condicion();
    const principal = await sql.ejecutar(
      `SELECT * FROM ${this.def.tabla}${texto}${this.def.orden ? ` ORDER BY ${this.def.orden}` : ''}`,
      valores
    );
    if (principal.length === 0) {
      // Tabla vacia: si el documento existe (la epoca anterior), se migra.
      const documento = await super.cargar();
      const { principal: filas } = this.def.aFilas(documento);
      if (filas.length > 0) {
        await this.escribir(documento);
        console.log(
          `[puente] tabla ${this.def.tabla}${this.def.filtro ? ` (${Object.values(this.def.filtro).join(',')})` : ''}: migradas ${filas.length} filas desde el documento "${this.def.clave}"`
        );
      }
      return this.leer();
    }
    const ids = principal.map((f) => String(f[this.def.id]));
    const sub: Record<string, Fila[]> = {};
    for (const st of this.def.subtablas ?? []) {
      sub[st.tabla] = await sql.ejecutar(
        `SELECT * FROM ${st.tabla} WHERE ${st.padre} = ANY($1::text[]) ORDER BY orden`,
        [ids]
      );
    }
    const valor = this.def.deFilas(principal, sub);
    this.recordar(this.def.aFilas(valor));
    return this.cargarDe(new Map([[this.def.clave, valor]]));
  }

  /** Igual que cargarDe del documento, pero aqui la coleccion no aplica. */
  override cargarDe(todos: Map<string, unknown>): T {
    return super.cargarDe(todos);
  }

  override async escribir(valor: T): Promise<T> {
    const sql = this.sql;
    if (!sql) {
      return super.escribir(valor);
    }
    const nuevas = this.def.aFilas(valor);
    const actuales = new Map<string, string>();
    for (const f of nuevas.principal) {
      actuales.set(String(f[this.def.id]), huella(f, nuevas.sub, this.def));
    }
    const cambiadas = nuevas.principal.filter(
      (f) =>
        this.previas.get(String(f[this.def.id])) !==
        actuales.get(String(f[this.def.id]))
    );
    const borradas = [...this.previas.keys()].filter((id) => !actuales.has(id));
    if (cambiadas.length > 0 || borradas.length > 0) {
      await sql.transaccion(async (ejecutar) => {
        if (borradas.length > 0) {
          for (const st of this.def.subtablas ?? []) {
            await ejecutar(
              `DELETE FROM ${st.tabla} WHERE ${st.padre} = ANY($1::text[])`,
              [borradas]
            );
          }
          const { texto, valores } = this.condicion(2);
          await ejecutar(
            `DELETE FROM ${this.def.tabla} WHERE ${this.def.id} = ANY($1::text[])${texto.replace(' WHERE ', ' AND ')}`,
            [borradas, ...valores]
          );
        }
        for (const fila of cambiadas) {
          const completa = { ...fila, ...(this.def.filtro ?? {}) };
          const columnas = Object.keys(completa);
          const marcas = columnas.map((_, i) => `$${i + 1}`);
          const actualiza = columnas
            .filter((c) => c !== this.def.id)
            .map((c) => `${c} = EXCLUDED.${c}`)
            .join(', ');
          await ejecutar(
            `INSERT INTO ${this.def.tabla} (${columnas.join(', ')}) VALUES (${marcas.join(', ')})
             ON CONFLICT (${this.def.id}) DO UPDATE SET ${actualiza}`,
            columnas.map((c) => aParametro(completa[c]))
          );
          const id = String(fila[this.def.id]);
          for (const st of this.def.subtablas ?? []) {
            await ejecutar(`DELETE FROM ${st.tabla} WHERE ${st.padre} = $1`, [
              id
            ]);
            const subfilas = (nuevas.sub[st.tabla] ?? []).filter(
              (sf) => String(sf[st.padre]) === id
            );
            for (const sf of subfilas) {
              const cols = Object.keys(sf);
              await ejecutar(
                `INSERT INTO ${st.tabla} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
                cols.map((c) => aParametro(sf[c]))
              );
            }
          }
        }
      });
    }
    this.previas = actuales;
    // El documento se conserva actualizado como respaldo legible.
    return super.escribir(valor);
  }

  /**
   * Deja la tabla exactamente como `valor`, sin importar lo que hubiera: borra
   * las filas de este almacen (y sus subfilas) y escribe todo de nuevo. Es lo
   * que usa la restauracion de un respaldo.
   */
  async reemplazar(valor: T): Promise<T> {
    const sql = this.sql;
    if (sql) {
      const { texto, valores } = this.condicion();
      const ids = (
        await sql.ejecutar(
          `SELECT ${this.def.id} AS id FROM ${this.def.tabla}${texto}`,
          valores
        )
      ).map((f) => String(f['id']));
      await sql.transaccion(async (ejecutar) => {
        for (const st of this.def.subtablas ?? []) {
          await ejecutar(
            `DELETE FROM ${st.tabla} WHERE ${st.padre} = ANY($1::text[])`,
            [ids]
          );
        }
        await ejecutar(`DELETE FROM ${this.def.tabla}${texto}`, valores);
      });
      this.previas = new Map();
    }
    return this.escribir(valor);
  }

  private recordar(filas: {
    principal: Fila[];
    sub: Record<string, Fila[]>;
  }): void {
    this.previas = new Map(
      filas.principal.map((f) => [
        String(f[this.def.id]),
        huella(f, filas.sub, this.def)
      ])
    );
  }
}

/** Una cadena que cambia si cambia la fila o cualquiera de sus subfilas. */
function huella<T>(
  fila: Fila,
  sub: Record<string, Fila[]>,
  def: DefinicionTabla<T>
): string {
  const id = String(fila[def.id]);
  const partes = [JSON.stringify(fila)];
  for (const st of def.subtablas ?? []) {
    partes.push(
      JSON.stringify(
        (sub[st.tabla] ?? []).filter((sf) => String(sf[st.padre]) === id)
      )
    );
  }
  return partes.join('|');
}

/** Objetos y listas van como JSON (columnas jsonb); lo demas tal cual. */
function aParametro(v: unknown): unknown {
  if (v === undefined) {
    return null;
  }
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v;
}
