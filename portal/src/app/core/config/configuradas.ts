import { HttpClient } from '@angular/common/http';
import { inject, provideAppInitializer } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AjustesPortalService } from './ajustes-portal.service';
import { aplicarAjustesServidor, apagadasAProposito } from './ajustes-portal';
import { LocalSettingsStore } from './local-settings.store';
import { PortalConfig } from './portal-config.model';

/** Lo que responde `GET /salud` del backend. */
interface Salud {
  conexiones?: { conexion: string; configurada: boolean }[];
}

/**
 * Qué conexión del backend enciende qué cuenta del portal. Los buzones
 * (`correo-*`) y los dominios se llaman igual en los dos lados.
 */
const CUENTA_DE: Record<string, string> = {
  anthropic: 'claude',
  openrouter: 'openrouter',
  cursor: 'cursor',
  figma: 'figma',
  vercel: 'vercel',
  monitoreo: 'plataformas',
  odoo: 'itech',
  github: 'github',
  ops: 'ops'
};

/**
 * Antes de arrancar, el portal le pregunta al backend qué está configurado y
 * enciende esas cuentas. Así lo que se configura desde cualquier módulo (o
 * desde el servidor) aparece solo, sin que nadie tenga que "activar" nada; y
 * lo que no está configurado no muestra datos, ni reales ni inventados.
 *
 * También pide los ajustes compartidos (`GET /ajustes-portal`): si el servidor
 * ya tiene, esos mandan sobre lo guardado en este navegador; si está vacío o no
 * contesta, se queda lo local, como antes. `base` es la configuración de
 * fábrica (con la raíz del puente), sin ajustes encima.
 *
 * Muta la configuración en su lugar a propósito: los adaptadores se construyen
 * después, a partir de ese mismo objeto.
 */
export function provideCuentasConfiguradas(
  config: PortalConfig,
  base: PortalConfig
) {
  return provideAppInitializer(async () => {
    if (!config.gatewayUrl) {
      return;
    }
    const http = inject(HttpClient);
    // Todo lo que se inyecta va antes del primer await: despues ya no hay
    // contexto de inyeccion.
    const local = inject(LocalSettingsStore);
    const ajustesPortal = inject(AjustesPortalService);
    // Las dos preguntas van juntas; ninguna tumba a la otra.
    const [ajustes, salud] = await Promise.all([
      ajustesPortal.cargarInicial(),
      firstValueFrom(http.get<Salud>(`${config.gatewayUrl}/salud`)).catch(
        () => undefined
      )
    ]);
    // Si el servidor tiene ajustes, mandan sobre lo local: se rehace la
    // configuración desde la de fábrica con los del servidor encima.
    if (ajustes) {
      const compartida = aplicarAjustesServidor(base, ajustes);
      config.accounts.splice(0, config.accounts.length, ...compartida.accounts);
      config.connections.splice(
        0,
        config.connections.length,
        ...compartida.connections
      );
    }
    const agregados = ajustes
      ? ajustes.buzonesAgregados
      : local.addedAccounts();
    const localesAgregados = new Set(agregados.map((a) => a.id));
    const apagadas = apagadasAProposito(
      ajustes ? ajustes.cuentasApagadas : local.settings().accountEnabled
    );
    if (!salud) {
      // Sin backend a la mano se arranca como está: los errores los dirá
      // cada módulo.
      return;
    }
    const configuradas = new Set(
      (salud.conexiones ?? [])
        .filter((c) => c.configurada)
        .map((c) => CUENTA_DE[c.conexion] ?? c.conexion)
    );
    const conBackend = new Set([
      ...Object.values(CUENTA_DE),
      ...(salud.conexiones ?? []).map((c) => c.conexion)
    ]);
    for (const account of config.accounts) {
      if (conBackend.has(account.id)) {
        account.enabled = configuradas.has(account.id);
      }
      // Lo que alguien apagó a propósito sigue apagado aunque el backend lo
      // tenga configurado.
      if (apagadas.has(account.id)) {
        account.enabled = false;
      }
    }
    // Un buzón que el backend ya no tiene (se quitó desde otro navegador o
    // desde el celular) no debe reaparecer aquí como "error": se saca de la
    // configuración, igual que si se hubiera quitado en este navegador.
    const buzonesDelBackend = new Set(
      (salud.conexiones ?? [])
        .map((c) => c.conexion)
        .filter((c) => c.startsWith('correo-'))
    );
    const quitar = new Set(
      config.accounts
        .filter(
          (a) =>
            a.id.startsWith('correo-') &&
            !buzonesDelBackend.has(a.id) &&
            !localesAgregados.has(a.id)
        )
        .map((a) => a.id)
    );
    if (quitar.size > 0) {
      config.accounts.splice(
        0,
        config.accounts.length,
        ...config.accounts.filter((a) => !quitar.has(a.id))
      );
      config.connections.splice(
        0,
        config.connections.length,
        ...config.connections.filter((c) => !quitar.has(c.accountId))
      );
    }
  });
}
