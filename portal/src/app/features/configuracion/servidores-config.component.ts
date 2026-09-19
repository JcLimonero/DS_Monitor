import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PuenteAdminService,
  ResultadoPrueba,
  ServidorVps,
  ServidorVpsEdicion
} from '../../core/sources/gateway/puente-admin.service';
import { VpsService } from '../../core/vps/vps.service';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/** Un renglón en edición: lo visible más lo que se escriba de secreto. */
interface Renglon extends ServidorVpsEdicion {
  conContrasena: boolean;
  conToken: boolean;
  nuevo?: boolean;
}

/**
 * Los servidores (VPS) que vigila el monitor: cada uno con la URL de su
 * Prometheus y sus propias credenciales. La etiqueta es el nombre que se ve
 * en Servidores, el carrusel, Hoy y Telegram. Las contraseñas nunca vuelven
 * al portal: en blanco se conserva la que había.
 */
@Component({
  selector: 'pt-servidores-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativePipe],
  templateUrl: './servidores-config.component.html'
})
export class ServidoresConfigComponent {
  private readonly admin = inject(PuenteAdminService);
  private readonly vps = inject(VpsService);

  readonly disponible = this.admin.disponible;
  readonly renglones = signal<Renglon[] | undefined>(undefined);
  readonly guardados = signal<ServidorVps[]>([]);
  readonly mensaje = signal<ResultadoPrueba | undefined>(undefined);
  readonly pruebas = signal<Record<string, ResultadoPrueba | 'probando'>>({});
  readonly ocupado = signal(false);

  constructor() {
    if (this.disponible) {
      this.cargar();
    }
  }

  cargar(): void {
    this.admin.servidores().subscribe({
      next: (lista) => {
        this.guardados.set(lista);
        this.renglones.set(
          lista.map((s) => ({
            id: s.id,
            etiqueta: s.etiqueta,
            url: s.url,
            usuario: s.usuario ?? '',
            contrasena: '',
            token: '',
            etiquetaNombre: s.etiquetaNombre ?? '',
            conContrasena: s.conContrasena,
            conToken: s.conToken
          }))
        );
      },
      error: (e: unknown) =>
        this.mensaje.set({ ok: false, mensaje: describe(e) })
    });
  }

  agregar(): void {
    this.renglones.update((r) => [
      ...(r ?? []),
      {
        etiqueta: '',
        url: '',
        usuario: 'dsmonitor',
        contrasena: '',
        token: '',
        etiquetaNombre: '',
        conContrasena: false,
        conToken: false,
        nuevo: true
      }
    ]);
  }

  cambiar(i: number, cambio: Partial<Renglon>): void {
    this.renglones.update((r) =>
      (r ?? []).map((x, j) => (j === i ? { ...x, ...cambio } : x))
    );
  }

  quitar(i: number): void {
    const r = this.renglones()?.[i];
    if (!r) {
      return;
    }
    if (r.nuevo || !r.id) {
      this.renglones.update((l) => (l ?? []).filter((_, j) => j !== i));
      return;
    }
    if (!confirm(`¿Quitar "${r.etiqueta}" de los servidores vigilados?`)) {
      return;
    }
    this.admin.borrarServidor(r.id).subscribe({
      next: () => {
        this.cargar();
        this.vps.cargar();
      },
      error: (e: unknown) =>
        this.mensaje.set({ ok: false, mensaje: describe(e) })
    });
  }

  guardar(): void {
    const lista = (this.renglones() ?? []).map((r) => ({
      id: r.id,
      etiqueta: r.etiqueta.trim(),
      url: r.url.trim(),
      usuario: r.usuario?.trim() || undefined,
      contrasena: r.contrasena?.trim() || undefined,
      token: r.token?.trim() || undefined,
      etiquetaNombre: r.etiquetaNombre?.trim() || undefined
    }));
    if (lista.some((s) => !s.etiqueta || !s.url)) {
      this.mensaje.set({
        ok: false,
        mensaje: 'Cada servidor necesita etiqueta y URL.'
      });
      return;
    }
    this.ocupado.set(true);
    this.admin.guardarServidores(lista).subscribe({
      next: (guardados) => {
        this.ocupado.set(false);
        this.mensaje.set({
          ok: true,
          mensaje: `${guardados.length} ${guardados.length === 1 ? 'servidor guardado' : 'servidores guardados'}.`
        });
        this.cargar();
        this.vps.cargar();
      },
      error: (e: unknown) => {
        this.ocupado.set(false);
        this.mensaje.set({ ok: false, mensaje: describe(e) });
      }
    });
  }

  probar(r: Renglon): void {
    if (!r.id || r.nuevo) {
      this.mensaje.set({
        ok: false,
        mensaje: 'Guarda primero y luego prueba.'
      });
      return;
    }
    const id = r.id;
    this.pruebas.update((p) => ({ ...p, [id]: 'probando' }));
    this.admin.probarServidor(id).subscribe({
      next: (res) => this.pruebas.update((p) => ({ ...p, [id]: res })),
      error: (e: unknown) =>
        this.pruebas.update((p) => ({
          ...p,
          [id]: { ok: false, mensaje: describe(e) }
        }))
    });
  }

  prueba(r: Renglon): ResultadoPrueba | 'probando' | undefined {
    return r.id ? this.pruebas()[r.id] : undefined;
  }
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
