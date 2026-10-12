/**
 * Carpetas del RAG en Drive. Los ids llegan por entorno: el repositorio es
 * publico y no guarda los de las empresas.
 */
export interface CuentaServicioDrive {
  clientEmail: string;
  privateKey: string;
}

export interface CarpetaEmpresaRag {
  empresaId: string;
  carpetaId: string;
}

export interface ConfiguracionRagDrive {
  cuenta: CuentaServicioDrive;
  raizId?: string;
  carpetas: CarpetaEmpresaRag[];
}

const CARPETAS: { variable: string; empresaId: string }[] = [
  { variable: 'RAG_DRIVE_CARPETA_DEALER', empresaId: 'dealer-solutions' },
  { variable: 'RAG_DRIVE_CARPETA_NEXUS', empresaId: 'nexusqtech' },
  { variable: 'RAG_DRIVE_CARPETA_OPERATIV', empresaId: 'operativai' },
  { variable: 'RAG_DRIVE_CARPETA_ITECH', empresaId: 'itech-dev' }
];

export function leerCuentaServicio(
  json: string | undefined
): CuentaServicioDrive | undefined {
  if (!json?.trim()) {
    return undefined;
  }
  let datos: unknown;
  try {
    datos = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!datos || typeof datos !== 'object') {
    return undefined;
  }
  const c = datos as Record<string, unknown>;
  const clientEmail =
    typeof c['client_email'] === 'string' ? c['client_email'].trim() : '';
  const cruda =
    typeof c['private_key'] === 'string' ? c['private_key'].trim() : '';
  if (!clientEmail || !cruda.includes('PRIVATE KEY')) {
    return undefined;
  }
  return {
    clientEmail,
    privateKey: cruda.replace(/\\n/g, '\n')
  };
}

export function configuracionRag(leer: {
  (nombre: string): string | undefined;
}): ConfiguracionRagDrive | undefined {
  const cuenta = leerCuentaServicio(leer('GOOGLE_DRIVE_CUENTA_SERVICIO'));
  if (!cuenta) {
    return undefined;
  }
  const carpetas = CARPETAS.flatMap((c) => {
    const carpetaId = leer(c.variable);
    return carpetaId ? [{ empresaId: c.empresaId, carpetaId }] : [];
  });
  return {
    cuenta,
    raizId: leer('RAG_DRIVE_RAIZ'),
    carpetas
  };
}

export function carpetaDeEmpresa(
  empresaId: string | undefined,
  carpetas: readonly CarpetaEmpresaRag[]
): string | undefined {
  if (!empresaId) {
    return undefined;
  }
  return carpetas.find((c) => c.empresaId === empresaId)?.carpetaId;
}
