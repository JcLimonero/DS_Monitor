import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ConfiguracionCorreo,
  ConfiguracionGoogle,
  ConfiguracionMicrosoft
} from '../config/entorno.js';

/**
 * Credenciales de buzones capturadas desde Ajustes.
 *
 * `CORREO_CUENTAS` sirve para lo que se configura una vez en el servidor.
 * Pero conectar un buzon es un tramite con idas y vueltas: probar una
 * contraseña, corregir el host, pasar por el consentimiento de Microsoft y
 * guardar el refresh token que regresa. Eso se hace desde el portal, y lo que
 * resulta se guarda aqui, un archivo por buzon, con permisos solo para el
 * usuario del proceso.
 *
 * Lo guardado se pone encima de lo del entorno: si un buzon existe en los dos
 * lados, gana lo capturado, que es lo mas reciente.
 */

export interface CredencialesGuardadas {
  proveedor?: 'google' | 'microsoft' | 'imap';
  host?: string;
  puerto?: number;
  usuario?: string;
  contrasena?: string;
  buzones?: string[];
  microsoft?: Partial<ConfiguracionMicrosoft>;
  google?: Partial<ConfiguracionGoogle>;
  /** True cuando se borro desde la aplicacion, aunque siga en el entorno. */
  borrado?: boolean;
  actualizadoEn: string;
}

export class AlmacenCorreo {
  private readonly guardadas = new Map<string, CredencialesGuardadas>();

  constructor(private readonly directorio: string) {}

  /** Lee del disco lo guardado en corridas anteriores. */
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
        this.guardadas.set(
          nombre.slice(0, -5),
          JSON.parse(crudo) as CredencialesGuardadas
        );
      } catch (error) {
        console.warn(`[puente] no se pudo leer ${nombre}:`, error);
      }
    }
    return this.guardadas.size;
  }

  /**
   * Borra el buzon. Si viene del entorno no se puede quitar de ahi, asi que
   * queda una marca que lo esconde; si se vuelve a guardar, revive.
   */
  async borrar(id: string): Promise<void> {
    const nuevo: CredencialesGuardadas = {
      borrado: true,
      actualizadoEn: new Date().toISOString()
    };
    this.guardadas.set(id, nuevo);
    await mkdir(this.directorio, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.directorio, `${id}.json`),
      JSON.stringify(nuevo, null, 2),
      { mode: 0o600 }
    );
  }

  obtener(id: string): CredencialesGuardadas | undefined {
    return this.guardadas.get(id);
  }

  ids(): string[] {
    return [...this.guardadas.keys()];
  }

  /** Mezcla lo nuevo con lo que habia y lo escribe. */
  async guardar(
    id: string,
    cambios: Omit<CredencialesGuardadas, 'actualizadoEn'>
  ): Promise<CredencialesGuardadas> {
    if (!/^[a-z0-9][a-z0-9_-]{0,48}$/i.test(id)) {
      throw new Error(`Identificador de buzón inválido: "${id}"`);
    }
    const anterior = this.guardadas.get(id);
    const nuevo: CredencialesGuardadas = {
      ...anterior,
      ...sinVacios(cambios),
      borrado: false,
      microsoft:
        cambios.microsoft || anterior?.microsoft
          ? { ...anterior?.microsoft, ...sinVacios(cambios.microsoft ?? {}) }
          : undefined,
      google:
        cambios.google || anterior?.google
          ? { ...anterior?.google, ...sinVacios(cambios.google ?? {}) }
          : undefined,
      actualizadoEn: new Date().toISOString()
    };
    this.guardadas.set(id, nuevo);
    await mkdir(this.directorio, { recursive: true, mode: 0o700 });
    await writeFile(
      join(this.directorio, `${id}.json`),
      JSON.stringify(nuevo, null, 2),
      { mode: 0o600 }
    );
    return nuevo;
  }

  /**
   * La configuracion efectiva de un buzon: lo del entorno con lo guardado
   * encima. Un buzon que solo existe guardado (se agrego desde el portal)
   * tambien cuenta, mientras traiga proveedor y usuario.
   */
  efectiva(
    id: string,
    base: ConfiguracionCorreo | undefined,
    diasAtras: number,
    appPorOmision?: Pick<
      ConfiguracionMicrosoft,
      'tenant' | 'clientId' | 'clientSecret'
    >,
    googlePorOmision?: Pick<ConfiguracionGoogle, 'clientId' | 'clientSecret'>
  ): ConfiguracionCorreo | undefined {
    const guardado = this.guardadas.get(id);
    if ((!base && !guardado) || guardado?.borrado) {
      return undefined;
    }
    const proveedor = guardado?.proveedor ?? base?.proveedor;
    const usuario = guardado?.usuario ?? base?.usuario;
    if (!proveedor || !usuario) {
      return base;
    }
    const microsoft =
      proveedor === 'microsoft'
        ? mezclarMicrosoft(
            base?.microsoft ?? appPorOmision,
            guardado?.microsoft
          )
        : undefined;
    const google =
      proveedor === 'google'
        ? mezclarGoogle(base?.google ?? googlePorOmision, guardado?.google)
        : undefined;
    return {
      id,
      proveedor,
      host: guardado?.host ?? base?.host ?? hostPorOmision(proveedor),
      puerto: guardado?.puerto ?? base?.puerto ?? 993,
      usuario,
      contrasena: guardado?.contrasena ?? base?.contrasena ?? '',
      accountId: base?.accountId ?? id,
      buzones: guardado?.buzones ?? base?.buzones ?? ['INBOX'],
      diasAtras: base?.diasAtras ?? diasAtras,
      microsoft,
      google
    };
  }
}

function mezclarMicrosoft(
  base: Partial<ConfiguracionMicrosoft> | undefined,
  guardado: Partial<ConfiguracionMicrosoft> | undefined
): ConfiguracionMicrosoft | undefined {
  const clientId = guardado?.clientId ?? base?.clientId;
  const clientSecret = guardado?.clientSecret ?? base?.clientSecret;
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return {
    tenant: guardado?.tenant ?? base?.tenant ?? 'common',
    clientId,
    clientSecret,
    refreshToken: guardado?.refreshToken ?? base?.refreshToken,
    conectadaComo: guardado?.conectadaComo ?? base?.conectadaComo
  };
}

function mezclarGoogle(
  base: Partial<ConfiguracionGoogle> | undefined,
  guardado: Partial<ConfiguracionGoogle> | undefined
): ConfiguracionGoogle | undefined {
  const clientId = guardado?.clientId ?? base?.clientId;
  const clientSecret = guardado?.clientSecret ?? base?.clientSecret;
  if (!clientId || !clientSecret) {
    return undefined;
  }
  return {
    clientId,
    clientSecret,
    refreshToken: guardado?.refreshToken ?? base?.refreshToken,
    conectadaComo: guardado?.conectadaComo ?? base?.conectadaComo
  };
}

function hostPorOmision(proveedor: ConfiguracionCorreo['proveedor']): string {
  return proveedor === 'google'
    ? 'imap.gmail.com'
    : proveedor === 'microsoft'
      ? 'outlook.office365.com'
      : '';
}

/** Quita las llaves sin valor para que no pisen lo que ya habia. */
function sinVacios<T extends object>(objeto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(objeto).filter(
      ([, valor]) => valor !== undefined && valor !== '' && valor !== null
    )
  ) as Partial<T>;
}
