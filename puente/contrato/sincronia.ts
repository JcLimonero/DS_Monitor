/**
 * Comprueba que el contrato del puente siga igual al modelo del portal.
 *
 * No se ejecuta: es una comprobacion de tipos. `npm run check:contrato` lo
 * compila contra los modelos reales del portal y falla si alguien agrega,
 * quita o cambia un campo de un solo lado.
 *
 * Vive fuera de `src/` a proposito: el servicio no debe depender del codigo del
 * portal en tiempo de ejecucion, solo esta comprobacion lo mira.
 */
import type * as Portal from '../../portal/src/app/core/models/index.js';
import type * as Puente from '../src/nucleo/contrato.js';

/** Falla la compilacion si `A` y `B` no son asignables en ambos sentidos. */
type Igual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/* eslint-disable @typescript-eslint/no-unused-vars */
type _Person = Igual<Portal.Person, Puente.Person>;
type _TaskItem = Igual<Portal.TaskItem, Puente.TaskItem>;
type _Meeting = Igual<Portal.Meeting, Puente.Meeting>;
type _MonitorTarget = Igual<Portal.MonitorTarget, Puente.MonitorTarget>;
type _MonitorCheck = Igual<Portal.MonitorCheck, Puente.MonitorCheck>;
type _CrmOpportunity = Igual<Portal.CrmOpportunity, Puente.CrmOpportunity>;
type _CrmActivity = Igual<Portal.CrmActivity, Puente.CrmActivity>;
type _LicenseUsage = Igual<Portal.LicenseUsage, Puente.LicenseUsage>;
type _LicenseMember = Igual<Portal.LicenseMember, Puente.LicenseMember>;
type _Deployment = Igual<Portal.Deployment, Puente.Deployment>;
type _PlatformStatus = Igual<Portal.PlatformStatus, Puente.PlatformStatus>;
type _RepoStatus = Igual<Portal.RepoStatus, Puente.RepoStatus>;
type _RepoPullRequest = Igual<Portal.RepoPullRequest, Puente.RepoPullRequest>;
type _RepoCommit = Igual<Portal.RepoCommit, Puente.RepoCommit>;

/**
 * Las marcas de abajo solo existen para que el compilador evalue los alias de
 * arriba; un alias sin usar no se comprueba a fondo.
 */
const comprobado: [
  _Person,
  _TaskItem,
  _Meeting,
  _MonitorTarget,
  _MonitorCheck,
  _CrmOpportunity,
  _CrmActivity,
  _LicenseUsage,
  _LicenseMember,
  _Deployment,
  _PlatformStatus,
  _RepoStatus,
  _RepoPullRequest,
  _RepoCommit
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true
];

export default comprobado;
