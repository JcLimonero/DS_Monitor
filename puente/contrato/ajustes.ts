/**
 * Comprueba que `AjustesPortal` del puente siga igual al del portal.
 *
 * Igual que `sincronia.ts`, no se ejecuta: es una comprobacion de tipos. El
 * buzon del puente es mas estricto que `Account` (solo tipos de correo), asi
 * que se pide que sea asignable al del portal y que los campos coincidan.
 */
import type * as Portal from '../../portal/src/app/core/models/index.js';
import type * as Puente from '../src/datos/ajustes-portal.js';

type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** Todo lo que el puente guarda lo puede leer el portal... */
type _Asignable = [Puente.AjustesPortal] extends [Portal.AjustesPortal]
  ? true
  : never;
/** ...y no sobra ni falta ningun campo de un lado. */
type _Campos = Igual<keyof Portal.AjustesPortal, keyof Puente.AjustesPortal>;
type _CamposBuzon = Igual<keyof Portal.Account, keyof Puente.CuentaPortal>;

const comprobado: [_Asignable, _Campos, _CamposBuzon] = [true, true, true];

export default comprobado;
