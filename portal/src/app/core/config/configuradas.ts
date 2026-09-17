import { HttpClient } from '@angular/common/http';
import { inject, provideAppInitializer } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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
 * Muta la configuración en su lugar a propósito: los adaptadores se construyen
 * después, a partir de ese mismo objeto.
 */
export function provideCuentasConfiguradas(config: PortalConfig) {
  return provideAppInitializer(async () => {
    if (!config.gatewayUrl) {
      return;
    }
    const http = inject(HttpClient);
    let salud: Salud;
    try {
      salud = await firstValueFrom(
        http.get<Salud>(`${config.gatewayUrl}/salud`)
      );
    } catch {
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
    }
  });
}
