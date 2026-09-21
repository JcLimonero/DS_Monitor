import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ACCOUNT_COLORS, isMailKind } from '../../core/config/local-settings';
import { PORTAL_CONFIG } from '../../core/config/portal-config.token';
import {
  EmpresaEdicion,
  EmpresasService,
  colorDerivado
} from '../../core/empresas/empresas.service';
import { AccountColor, Empresa } from '../../core/models';
import {
  PuenteAdminService,
  ResultadoPrueba
} from '../../core/sources/gateway/puente-admin.service';
import { ACCOUNT_CHIP_CLASS } from '../../ui/account-colors';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/** Un renglón en edición. */
interface Renglon {
  id?: string;
  nombre: string;
  descripcion: string;
  color: AccountColor | '';
  cuentas: string[];
  activa: boolean;
  nuevo?: boolean;
}

/** Un buzón que se puede marcar como de la empresa. */
interface Buzon {
  id: string;
  label: string;
  detail?: string;
}

type DialogoEmpresa = { modo: 'alta' } | { modo: 'edicion'; indice: number };

/**
 * Las empresas del grupo: nombre, descripción para la IA, color, buzones que
 * le pertenecen y si está activa. La lista completa se guarda en el puente;
 * de ahí salen los selectores de la tarjeta, Pendientes y Dictado, el
 * "quiénes somos" de cada prompt y a qué empresa se etiqueta lo que llega
 * por cada buzón. Renombrar reetiqueta lo ya guardado; borrar solo se puede
 * si no hay pendientes abiertos con esa empresa (si no, se desactiva).
 *
 * Alta y edición van en un diálogo para que la lista se quede compacta y el
 * menú de Integraciones no se salga de la vista.
 */
@Component({
  selector: 'pt-empresas-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogoComponent, FormsModule, IconComponent, RelativePipe],
  templateUrl: './empresas-config.component.html'
})
export class EmpresasConfigComponent {
  private readonly admin = inject(PuenteAdminService);
  private readonly catalogo = inject(EmpresasService);
  private readonly config = inject(PORTAL_CONFIG);

  readonly disponible = this.admin.disponible;
  readonly colores = ACCOUNT_COLORS;
  readonly renglones = signal<Renglon[] | undefined>(undefined);
  readonly guardadas = signal<Empresa[]>([]);
  readonly mensaje = signal<ResultadoPrueba | undefined>(undefined);
  readonly ocupado = signal(false);
  readonly dialogo = signal<DialogoEmpresa | undefined>(undefined);
  readonly borrador = signal<Renglon>(renglonVacio());

  readonly tituloDialogo = computed(() =>
    this.dialogo()?.modo === 'alta' ? 'Agregar empresa' : 'Editar empresa'
  );

  /** Los buzones del portal y, además, cualquier id que ya tenga una empresa. */
  readonly buzones = computed<Buzon[]>(() => {
    const propios: Buzon[] = this.config.accounts
      .filter((a) => isMailKind(a.kind))
      .map((a) => ({ id: a.id, label: a.label, detail: a.detail }));
    const conocidos = new Set(propios.map((b) => b.id));
    const extra: Buzon[] = [];
    for (const r of this.renglones() ?? []) {
      for (const id of r.cuentas) {
        if (!conocidos.has(id)) {
          conocidos.add(id);
          extra.push({ id, label: id });
        }
      }
    }
    return [...propios, ...extra];
  });

  /** La última edición, para el pie. */
  readonly ultimaEdicion = computed(() => {
    const fechas = this.guardadas()
      .map((e) => e.actualizadoEn)
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
    this.admin.empresas().subscribe({
      next: (lista) => {
        this.guardadas.set(lista);
        this.catalogo.todas.set(lista);
        this.renglones.set(
          [...lista]
            .sort((a, b) => a.orden - b.orden)
            .map((e) => ({
              id: e.id,
              nombre: e.nombre,
              descripcion: e.descripcion ?? '',
              color: esColor(e.color) ? e.color : '',
              cuentas: [...e.cuentas],
              activa: e.activa
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
    this.borrador.set({ ...r, cuentas: [...r.cuentas] });
    this.dialogo.set({ modo: 'edicion', indice: i });
  }

  cerrarDialogo(): void {
    this.dialogo.set(undefined);
  }

  cambiarBorrador(cambio: Partial<Renglon>): void {
    this.borrador.update((x) => ({ ...x, ...cambio }));
  }

  marcarBuzonBorrador(id: string, marcado: boolean): void {
    this.borrador.update((x) => {
      const sin = x.cuentas.filter((c) => c !== id);
      return { ...x, cuentas: marcado ? [...sin, id] : sin };
    });
  }

  tieneBuzon(r: Renglon, id: string): boolean {
    return r.cuentas.includes(id);
  }

  confirmarDialogo(): void {
    const b = this.borrador();
    if (!b.nombre.trim()) {
      this.mensaje.set({
        ok: false,
        mensaje: 'Cada empresa necesita un nombre.'
      });
      return;
    }
    const d = this.dialogo();
    if (!d) {
      return;
    }
    const fila: Renglon = {
      ...b,
      nombre: b.nombre.trim(),
      descripcion: b.descripcion.trim()
    };
    this.renglones.update((lista) => {
      const next = [...(lista ?? [])];
      if (d.modo === 'alta') {
        next.push({ ...fila, nuevo: true });
      } else {
        next[d.indice] = fila;
      }
      const idx = d.modo === 'alta' ? next.length - 1 : d.indice;
      const tomadas = new Set(next[idx]?.cuentas ?? []);
      return next.map((x, j) =>
        j === idx
          ? x
          : { ...x, cuentas: x.cuentas.filter((c) => !tomadas.has(c)) }
      );
    });
    this.dialogo.set(undefined);
    this.guardar();
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
    if (
      !confirm(
        `¿Quitar "${r.nombre}" del catálogo? Si tiene pendientes abiertos el puente no lo permite; en ese caso desactívala.`
      )
    ) {
      return;
    }
    this.renglones.update((l) => (l ?? []).filter((_, j) => j !== i));
    this.guardar();
  }

  /** La clase del chip de muestra: el color elegido o el derivado del nombre. */
  claseDe(r: Renglon): string {
    const color =
      r.color || (r.nombre.trim() ? colorDerivado(r.nombre) : 'slate');
    return ACCOUNT_CHIP_CLASS[color];
  }

  resumen(r: Renglon): string {
    const partes: string[] = [];
    if (r.descripcion.trim()) {
      partes.push(r.descripcion.trim());
    }
    const n = r.cuentas.length;
    partes.push(n === 1 ? '1 buzón' : `${n} buzones`);
    return partes.join(' · ');
  }

  guardar(): void {
    const lista: EmpresaEdicion[] = (this.renglones() ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre.trim(),
      descripcion: r.descripcion.trim() || undefined,
      color: r.color || undefined,
      cuentas: r.cuentas,
      activa: r.activa
    }));
    if (lista.some((e) => !e.nombre)) {
      this.mensaje.set({
        ok: false,
        mensaje: 'Cada empresa necesita un nombre.'
      });
      return;
    }
    this.ocupado.set(true);
    this.catalogo.guardar(lista).subscribe({
      next: (guardadas) => {
        this.ocupado.set(false);
        const activas = guardadas.filter((e) => e.activa).length;
        this.mensaje.set({
          ok: true,
          mensaje: `${guardadas.length} ${guardadas.length === 1 ? 'empresa guardada' : 'empresas guardadas'} (${activas} ${activas === 1 ? 'activa' : 'activas'}).`
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

function renglonVacio(): Renglon {
  return {
    nombre: '',
    descripcion: '',
    color: '',
    cuentas: [],
    activa: true,
    nuevo: true
  };
}

function esColor(color: string | undefined): color is AccountColor {
  return !!color && (ACCOUNT_COLORS as readonly string[]).includes(color);
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
