import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/** Un renglón en edición: lo visible más lo que se escriba de secreto. */
interface Renglon extends ServidorVpsEdicion {
  conContrasena: boolean;
  conToken: boolean;
  nuevo?: boolean;
}

type DialogoServidor = { modo: 'alta' } | { modo: 'edicion'; indice: number };

/**
 * Los servidores (VPS) que vigila el monitor: cada uno con la URL de su
 * Prometheus y sus propias credenciales. La etiqueta es el nombre que se ve
 * en Servidores, el carrusel, Hoy y Telegram. Las contraseñas nunca vuelven
 * al portal: en blanco se conserva la que había.
 *
 * Alta y edición van en un diálogo para que la lista se quede compacta.
 */
@Component({
  selector: 'pt-servidores-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogoComponent, FormsModule, IconComponent, RelativePipe],
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
  readonly dialogo = signal<DialogoServidor | undefined>(undefined);
  readonly borrador = signal<Renglon>(renglonVacio());

  readonly tituloDialogo = computed(() =>
    this.dialogo()?.modo === 'alta' ? 'Agregar servidor' : 'Editar servidor'
  );

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

  abrirAlta(): void {
    this.borrador.set(renglonVacio());
    this.dialogo.set({ modo: 'alta' });
  }

  abrirEdicion(i: number): void {
    const r = this.renglones()?.[i];
    if (!r) {
      return;
    }
    this.borrador.set({ ...r, contrasena: '', token: '' });
    this.dialogo.set({ modo: 'edicion', indice: i });
  }

  cerrarDialogo(): void {
    this.dialogo.set(undefined);
  }

  cambiarBorrador(cambio: Partial<Renglon>): void {
    this.borrador.update((x) => ({ ...x, ...cambio }));
  }

  confirmarDialogo(): void {
    const b = this.borrador();
    if (!b.etiqueta.trim() || !b.url.trim()) {
      this.mensaje.set({
        ok: false,
        mensaje: 'Cada servidor necesita etiqueta y URL.'
      });
      return;
    }
    const d = this.dialogo();
    if (!d) {
      return;
    }
    const fila: Renglon = {
      ...b,
      etiqueta: b.etiqueta.trim(),
      url: b.url.trim()
    };
    this.renglones.update((lista) => {
      const next = [...(lista ?? [])];
      if (d.modo === 'alta') {
        next.push({ ...fila, nuevo: true });
      } else {
        next[d.indice] = fila;
      }
      return next;
    });
    this.dialogo.set(undefined);
    this.guardar();
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

  resumen(r: Renglon): string {
    const partes = [r.url];
    if (r.usuario) {
      partes.push(r.usuario);
    }
    return partes.filter(Boolean).join(' · ');
  }
}

function renglonVacio(): Renglon {
  return {
    etiqueta: '',
    url: '',
    usuario: 'dsmonitor',
    contrasena: '',
    token: '',
    etiquetaNombre: '',
    conContrasena: false,
    conToken: false,
    nuevo: true
  };
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
