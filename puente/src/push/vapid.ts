import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign
} from 'node:crypto';

/**
 * VAPID: la firma con la que el puente se identifica ante el servicio de
 * push de cada navegador (Google, Apple, Mozilla). Es un par de llaves P-256;
 * la publica se le da al navegador al suscribirse y la privada firma un JWT
 * corto por cada envio. Todo con node:crypto, sin dependencias.
 */
export interface ClavesVapid {
  /** Clave publica en base64url, tal como la pide PushManager.subscribe. */
  publica: string;
  /** Clave privada en PKCS8 PEM; nunca sale del puente. */
  privadaPem: string;
}

export function generarClaves(): ClavesVapid {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  });
  const jwk = publicKey.export({ format: 'jwk' });
  // Punto sin comprimir: 0x04 || X || Y, 65 bytes.
  const x = Buffer.from(jwk.x as string, 'base64url');
  const y = Buffer.from(jwk.y as string, 'base64url');
  const cruda = Buffer.concat([Buffer.from([4]), x, y]);
  return {
    publica: cruda.toString('base64url'),
    privadaPem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string
  };
}

/** El encabezado Authorization para un envio al `endpoint` dado. */
export function encabezadoVapid(
  claves: ClavesVapid,
  endpoint: string,
  contacto: string,
  ahora = new Date()
): string {
  const audiencia = new URL(endpoint).origin;
  const cabecera = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = base64url(
    JSON.stringify({
      aud: audiencia,
      exp: Math.floor(ahora.getTime() / 1000) + 12 * 3600,
      sub: contacto.startsWith('mailto:') ? contacto : `mailto:${contacto}`
    })
  );
  const firma = sign('sha256', Buffer.from(`${cabecera}.${cuerpo}`), {
    key: createPrivateKey(claves.privadaPem),
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url');
  return `vapid t=${cabecera}.${cuerpo}.${firma}, k=${claves.publica}`;
}

/** Comprueba que la clave publica guardada corresponde a la privada. */
export function clavesCoherentes(claves: ClavesVapid): boolean {
  try {
    const publica = createPublicKey(createPrivateKey(claves.privadaPem));
    const jwk = publica.export({ format: 'jwk' });
    const cruda = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x as string, 'base64url'),
      Buffer.from(jwk.y as string, 'base64url')
    ]);
    return cruda.toString('base64url') === claves.publica;
  } catch {
    return false;
  }
}

function base64url(texto: string): string {
  return Buffer.from(texto).toString('base64url');
}
