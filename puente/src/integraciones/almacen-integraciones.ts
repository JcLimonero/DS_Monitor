import { leerConfiguracion, type Configuracion } from '../config/entorno.js';
import type { Persistencia } from '../datos/persistencia.js';

/**
 * Variables de integraciones capturadas desde Ajustes.
 *
 * Un documento por integracion (coleccion `integraciones`) con las
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

  constructor(private readonly persistencia: Persistencia) {}

  async cargar(): Promise<number> {
    for (const [id, valor] of await this.persistencia.leerColeccion(
      'integraciones'
    )) {
      this.guardadas.set(id, valor as Guardado);
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
    const guardado: Guardado = {
      variables,
      actualizadoEn: new Date().toISOString()
    };
    this.guardadas.set(id, guardado);
    await this.persistencia.guardar('integraciones', id, guardado);
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
