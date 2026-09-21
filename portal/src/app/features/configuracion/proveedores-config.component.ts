import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ACCOUNT_COLORS } from '../../core/config/local-settings';
import {
  ProveedorEdicion,
  ProveedoresService,
  colorDerivadoProveedor
} from '../../core/proveedores/proveedores.service';
import { AccountColor, Proveedor } from '../../core/models';
import {
  PuenteAdminService,
  ResultadoPrueba
} from '../../core/sources/gateway/puente-admin.service';
import { ACCOUNT_CHIP_CLASS } from '../../ui/account-colors';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/** Un renglón en edición. */
interface Renglon {
  id?: string;
  nombre: string;
  descripcion: string;
  color: AccountColor | '';
  activa: boolean;
  nuevo?: boolean;
}

/**
 * Los proveedores y clientes externos: nombre, descripción para la IA, color
 * y si está activo. La lista completa se guarda en el puente; de ahí salen
 * los selectores de la tarjeta, Pendientes y Dictado y lo que se le cuenta
 * a la IA. Renombrar reetiqueta lo ya guardado; borrar solo se puede si no
 * hay pendientes abiertos con ese proveedor (si no, se desactiva).
 */
@Component({
  selector: 'pt-proveedores-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativePipe],
  templateUrl: './proveedores-config.component.html'
})
export class ProveedoresConfigComponent {
  private readonly admin = inject(PuenteAdminService);
  private readonly catalogo = inject(ProveedoresService);

  readonly disponible = this.admin.disponible;
  readonly colores = ACCOUNT_COLORS;
  readonly renglones = signal<Renglon[] | undefined>(undefined);
  readonly guardadas = signal<Proveedor[]>([]);
  readonly mensaje = signal<ResultadoPrueba | undefined>(undefined);
  readonly ocupado = signal(false);

  /** La última edición, para el pie. */
  readonly ultimaEdicion = computed(() => {
    const fechas = this.guardadas()
      .map((p) => p.actualizadoEn)
      .filter(Boolean)
      .sort();
    return fechas[fechas.length - 1];
  });

  constructor() {
    if (this.disponible) {
      this.cargar();
    }
  }

  cargar(): void {
    this.admin.proveedores().subscribe({
      next: (lista) => {
        this.guardadas.set(lista);
        this.catalogo.todas.set(lista);
        this.renglones.set(
          [...lista]
            .sort((a, b) => a.orden - b.orden)
            .map((p) => ({
              id: p.id,
              nombre: p.nombre,
              descripcion: p.descripcion ?? '',
              color: esColor(p.color) ? p.color : '',
              activa: p.activa
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
        nombre: '',
        descripcion: '',
        color: '',
        activa: true,
        nuevo: true
      }
    ]);
  }

  cambiar(i: number, cambio: Partial<Renglon>): void {
    this.renglones.update((r) =>
      (r ?? []).map((x, j) => (j === i ? { ...x, ...cambio } : x))
    );
  }

  mover(i: number, delta: -1 | 1): void {
    this.renglones.update((r) => {
      const lista = [...(r ?? [])];
      const j = i + delta;
      const a = lista[i];
      const b = lista[j];
      if (!a || !b) {
        return lista;
      }
      lista[i] = b;
      lista[j] = a;
      return lista;
    });
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
    if (
      !confirm(
        `¿Quitar "${r.nombre}" del catálogo? Si tiene pendientes abiertos el puente no lo permite; en ese caso desactívalo.`
      )
    ) {
      return;
    }
    this.renglones.update((l) => (l ?? []).filter((_, j) => j !== i));
  }

  /** La clase del chip de muestra: el color elegido o el derivado del nombre. */
  claseDe(r: Renglon): string {
    const color =
      r.color || (r.nombre.trim() ? colorDerivadoProveedor(r.nombre) : 'slate');
    return ACCOUNT_CHIP_CLASS[color];
  }

  guardar(): void {
    const lista: ProveedorEdicion[] = (this.renglones() ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre.trim(),
      descripcion: r.descripcion.trim() || undefined,
      color: r.color || undefined,
      activa: r.activa
    }));
    if (lista.some((p) => !p.nombre)) {
      this.mensaje.set({
        ok: false,
        mensaje: 'Cada proveedor necesita un nombre.'
      });
      return;
    }
    this.ocupado.set(true);
    this.catalogo.guardar(lista).subscribe({
      next: (guardadas) => {
        this.ocupado.set(false);
        const activas = guardadas.filter((p) => p.activa).length;
        this.mensaje.set({
          ok: true,
          mensaje: `${guardadas.length} ${guardadas.length === 1 ? 'proveedor guardado' : 'proveedores guardados'} (${activas} ${activas === 1 ? 'activo' : 'activos'}).`
        });
        this.cargar();
      },
      error: (e: unknown) => {
        this.ocupado.set(false);
        this.mensaje.set({ ok: false, mensaje: describe(e) });
      }
    });
  }
}

function esColor(color: string | undefined): color is AccountColor {
  return !!color && (ACCOUNT_COLORS as readonly string[]).includes(color);
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
