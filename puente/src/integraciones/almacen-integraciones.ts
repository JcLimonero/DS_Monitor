import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { leerConfiguracion, type Configuracion } from '../config/entorno.js';

/**
 * Variables de integraciones capturadas desde Ajustes.
 *
 * Un archivo por integracion (`datos/integraciones/github.json`) con las
 * variables tal cual irian en el `.env`. Al leer la configuracion se ponen
 * encima del entorno: asi una credencial capturada desde el portal y una del
 * panel del servidor se comportan igual, y `.env.example` sigue siendo la
 * unica lista de variables que existe.
 */

interface Guardado {
  variables: Record<string, string>;
  actualizadoEn: string;
}

export class AlmacenIntegraciones {
  private readonly guardadas = new Map<string, Guardado>();

  constructor(private readonly directorio: string) {}

  async cargar(): Promise<number> {
    let nombres: string[];
    try {
      nombres = await readdir(this.directorio);
    } catch {
      return 0;
    }
    for (const nombre of nombres) {
      if (!nombre.endsWith('.json')) {
        continue;
      }
      try {
        const crudo = await readFile(join(this.directorio, nombre), 'utf8');
        this.guardadas.set(nombre.slice(0, -5), JSON.parse(crudo) as Guardado);
      } catch (error) {
        console.warn(`[puente] no se pudo leer ${nombre}:`, error);
      }
    }
    return this.guardadas.size;
  }

  variablesDe(id: string): Record<string, string> {
    return this.guardadas.get(id)?.variables ?? {};
  }

  /** Todas las variables guardadas, de todas las integraciones. */
  variables(): Record<string, string> {
    return Object.assign(
      {},
      ...[...this.guardadas.values()].map((g) => g.variables)
    ) as Record<string, string>;
  }

  /**
   * Guarda las variables de una integracion. Una variable con valor vacio se
   * quita (vuelve a valer lo del entorno); una que no venga se deja como esta.
   */
  async guardar(
    id: string,
    cambios: Record<string, string | undefined>
  ): Promise<Record<string, string>> {
    if (!/^[a-z0-9][a-z0-9_-]{0,48}$/i.test(id)) {
      throw new Error(`Identificador de integración inválido: "${id}"`);
    }
    const variables = { ...this.variablesDe(id) };
    for (const [nombre, valor] of Object.entries(cambios)) {
      if (valor === undefined) {
        continue;
      }
      if (valor.trim() === '') {
        delete variables[nombre];
      } else {
        variables[nombre] = valor.trim();
      }
    }
    this.guardadas.set(id, {
      variables,
      actualizadoEn: new Date().toISOString()
    });
    await mkdir(this.directorio, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.directorio, `${id}.json`),
      JSON.stringify(
        { variables, actualizadoEn: new Date().toISOString() },
        null,
        2
      ),
      { mode: 0o600 }
    );
    return variables;
  }
}

/**
 * La configuracion efectiva: el entorno con lo guardado encima. Se vuelve a
 * leer solo cuando algo cambia, porque las rutas la piden en cada peticion.
 */
export class Configurador {
  private actual: Configuracion | undefined;

  constructor(private readonly almacen: AlmacenIntegraciones) {}

  config(): Configuracion {
    if (!this.actual) {
      this.actual = leerConfiguracion({
        ...process.env,
        ...this.almacen.variables()
      });
    }
    return this.actual;
  }

  invalidar(): void {
    this.actual = undefined;
  }
}
