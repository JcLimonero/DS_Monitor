import type { CredencialesBuzon } from '../sources/gateway/puente-admin.service';

/**
 * Lo que se manda al puente al guardar un buzón, a partir del borrador del
 * diálogo "Editar conexión".
 *
 * La aplicación propia (client ID y secret) solo viaja en buzones de
 * Microsoft. El secreto sigue la regla de los demás secretos del portal: vacío
 * = sin cambio (no se manda), un espacio = quitar la aplicación propia. Por eso
 * el secreto no se recorta: un espacio tiene que llegar tal cual.
 */
export function credencialesParaGuardar(
  borrador: CredencialesBuzon
): CredencialesBuzon {
  const { tenant, clientId, clientSecret, puerto, ...resto } = borrador;
  const salida: CredencialesBuzon = {
    ...resto,
    puerto: Number(puerto) || undefined
  };
  if (borrador.proveedor !== 'microsoft') {
    return salida;
  }
  salida.tenant = tenant;
  const id = (clientId ?? '').trim();
  if (id !== '') {
    salida.clientId = id;
  }
  if ((clientSecret ?? '') !== '') {
    salida.clientSecret = clientSecret;
  }
  return salida;
}
