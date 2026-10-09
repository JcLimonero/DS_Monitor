/**
 * Aplicacion de Entra ID propia de un buzon de Microsoft.
 *
 * Por omision todos los buzones usan la aplicacion general (Integraciones →
 * Microsoft). Un buzon puede traer la suya (client ID + client secret +
 * tenant) cuando su directorio no deja consentir la general. Este archivo
 * solo tiene logica pura: validar lo que llega del portal y decidir que cambia
 * en lo guardado. No toca disco ni red.
 */

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANTS_ESPECIALES = new Set(['common', 'organizations', 'consumers']);
/** Un dominio de directorio (contoso.onmicrosoft.com), que Entra tambien acepta. */
const DOMINIO =
  /^(?=.{3,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
/** Los secretos de Entra son ASCII imprimible sin espacios (~40 caracteres). */
const SECRETO = /^[\x21-\x7e]{8,256}$/;

export function esGuid(valor: string): boolean {
  return GUID.test(valor);
}

export function esTenantValido(valor: string): boolean {
  return (
    TENANTS_ESPECIALES.has(valor.toLowerCase()) ||
    GUID.test(valor) ||
    DOMINIO.test(valor)
  );
}

export function esSecretoValido(valor: string): boolean {
  return SECRETO.test(valor);
}

/** Lo que se guarda de la aplicacion de un buzon (y de la general). */
export interface AppMicrosoft {
  clientId: string;
  clientSecret: string;
}

/**
 * La aplicacion propia de un buzon: solo cuenta si estan los dos, client ID y
 * secret. Uno solo no sirve para nada (el secreto es de UNA aplicacion), asi
 * que nunca se mezcla un ID propio con el secreto de la general.
 */
export function appPropiaDe(
  guardado: { clientId?: unknown; clientSecret?: unknown } | undefined
): AppMicrosoft | undefined {
  const clientId = guardado?.clientId;
  const clientSecret = guardado?.clientSecret;
  return typeof clientId === 'string' &&
    clientId !== '' &&
    typeof clientSecret === 'string' &&
    clientSecret !== ''
    ? { clientId, clientSecret }
    : undefined;
}

export type ResultadoAppPropia =
  | {
      ok: true;
      /** Tenant nuevo; `undefined` = no cambia. */
      tenant?: string;
      /** Quitar la aplicacion propia y volver a la general. */
      quitar: boolean;
      /** Aplicacion propia nueva o actualizada; `undefined` = no cambia. */
      app?: AppMicrosoft;
    }
  | { ok: false; error: string };

/** Un texto con algo escrito, o '' si viene vacio. Lo que no es texto es error. */
function crudo(valor: unknown): string | null {
  if (valor === undefined || valor === null) {
    return '';
  }
  return typeof valor === 'string' ? valor : null;
}

/**
 * Valida lo que el portal manda de la aplicacion. Misma semantica que los
 * secretos de Integraciones: vacio = sin cambio, un espacio = borrar.
 *
 * Los mensajes de error nunca repiten el valor recibido.
 */
export function validarAppPropia(
  entrada: { tenant?: unknown; clientId?: unknown; clientSecret?: unknown },
  actual: AppMicrosoft | undefined
): ResultadoAppPropia {
  const tenant = crudo(entrada.tenant);
  const id = crudo(entrada.clientId);
  const secreto = crudo(entrada.clientSecret);
  if (tenant === null || id === null || secreto === null) {
    return { ok: false, error: 'Los datos de la aplicación deben ser texto.' };
  }

  let tenantNuevo: string | undefined;
  if (tenant.trim() !== '') {
    tenantNuevo = tenant.trim();
    if (!esTenantValido(tenantNuevo)) {
      return {
        ok: false,
        error:
          'El tenant debe ser un Id. de directorio (GUID), un dominio, o common, organizations o consumers.'
      };
    }
  }

  // Un espacio (solo espacios) en el ID o en el secreto quita la aplicacion.
  const borra = (v: string) => v !== '' && v.trim() === '';
  if (borra(id) || borra(secreto)) {
    return { ok: true, tenant: tenantNuevo, quitar: true };
  }

  const idNuevo = id.trim().toLowerCase();
  const secretoNuevo = secreto.trim();
  if (idNuevo === '' && secretoNuevo === '') {
    return { ok: true, tenant: tenantNuevo, quitar: false };
  }
  if (idNuevo !== '' && !esGuid(idNuevo)) {
    return {
      ok: false,
      error: 'El client ID debe ser un GUID (Id. de aplicación de Entra ID).'
    };
  }
  if (secretoNuevo !== '' && !esSecretoValido(secretoNuevo)) {
    return {
      ok: false,
      error:
        'El client secret no es válido: usa el VALOR del secreto (no su ID), de 8 a 256 caracteres sin espacios.'
    };
  }

  const clientId = idNuevo || actual?.clientId.toLowerCase() || '';
  if (clientId === '') {
    return {
      ok: false,
      error: 'Falta el client ID de la aplicación propia.'
    };
  }
  // Un secreto es de una sola aplicacion: si el ID es otro, el viejo no sirve.
  const cambiaId = actual?.clientId.toLowerCase() !== clientId;
  if (secretoNuevo === '') {
    if (cambiaId || !actual) {
      return {
        ok: false,
        error:
          'Al poner o cambiar el client ID hay que escribir también su client secret.'
      };
    }
    // Mismo ID y sin secreto nuevo: no hay nada que cambiar.
    return { ok: true, tenant: tenantNuevo, quitar: false };
  }
  return {
    ok: true,
    tenant: tenantNuevo,
    quitar: false,
    app: { clientId, clientSecret: secretoNuevo }
  };
}

/**
 * Quita de un texto (mensaje de error, URL) cada secreto que pudiera traer.
 * Los valores muy cortos no se tocan: no son secretos y destrozarian el texto.
 */
export function ocultarSecretos(
  texto: string,
  secretos: (string | undefined)[]
): string {
  let salida = texto;
  for (const secreto of secretos) {
    if (secreto && secreto.length >= 6) {
      salida = salida.split(secreto).join('[oculto]');
    }
  }
  return salida;
}
