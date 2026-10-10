import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  Emisor,
  PuenteAdminService
} from '../../core/sources/gateway/puente-admin.service';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/**
 * La API para que otro sistema alimente un módulo: quién puede mandar (los
 * emisores), con qué token, y cómo se manda. El token se enseña una sola vez,
 * al crearlo, dentro del diálogo de alta.
 */
@Component({
  selector: 'pt-emisores-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogoComponent, FormsModule, IconComponent, RelativePipe],
  templateUrl: './emisores-config.component.html'
})
export class EmisoresConfigComponent {
  private readonly admin = inject(PuenteAdminService);

  readonly titulo = input('API para alimentar este módulo');
  readonly descripcion = input('');
  /** Qué tipos de envío se ofrecen aquí (pendientes, equipo...). */
  readonly tipos = input.required<string[]>();
  /** Cuenta del portal con la que se marcan los datos del emisor. */
  readonly cuenta = input('ops');
  /** Si el panel es el de ejecuciones, la nota de "cómo se manda" es otra. */
  readonly deEjecuciones = computed(() => this.tipos()[0] === 'ejecuciones');
  /** Si se permiten todos los tipos (panel de Director). */
  readonly modoAdmin = input(false);

  readonly disponible = this.admin.disponible;
  readonly apiUrl = this.admin.apiUrl;
  readonly emisores = signal<Emisor[] | undefined>(undefined);
  readonly tiposDisponibles = signal<string[]>([]);
  readonly nuevoNombre = signal('');
  readonly tiposNuevos = signal<string[]>([]);
  readonly creado = signal<{ nombre: string; token: string } | undefined>(
    undefined
  );
  readonly mensaje = signal<string | undefined>(undefined);
  readonly ocupado = signal(false);
  readonly dialogo = signal(false);

  readonly editando = signal<Emisor | undefined>(undefined);
  readonly tiposEditados = signal<string[]>([]);
  readonly dialogoEdicion = signal(false);

  readonly tituloDialogo = computed(() =>
    this.creado() ? 'Token creado' : 'Crear token'
  );

  /** Solo los emisores que pueden mandar alguno de los tipos de este panel. */
  readonly propios = computed(() => {
    const lista = this.emisores() ?? [];
    if (this.modoAdmin()) {
      return lista;
    }
    return lista.filter((e) => e.tipos.some((t) => this.tipos().includes(t)));
  });

  readonly ejemplo = computed(() => {
    const tipo = this.tipos()[0] ?? 'pendientes';
    const cuerpo =
      tipo === 'equipo'
        ? '{"version":1,"datos":[{"nombre":"Ana Robles","correo":"ana@empresa.com","rol":"Frontend"}]}'
        : tipo === 'ejecuciones'
          ? '{"integracion":"odoo-sync","nombre":"Sincronía con Odoo","estado":"ok","mensaje":"48 facturas","duracionMs":1520,"cadaMinutos":60}'
          : '{"version":1,"datos":[{"id":"482","titulo":"Reintentos del envío","prioridad":"alta","venceEn":"2026-09-20T13:00:00Z"}]}';
    return `curl -X POST ${this.apiUrl}/ingesta/${tipo} \\\\\n  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\\\\n  -d '${cuerpo}'`;
  });

  constructor() {
    if (this.disponible) {
      this.cargar();
      this.cargarTiposDisponibles();
    }
  }

  cargar(): void {
    this.admin.emisores().subscribe({
      next: (lista) => this.emisores.set(lista),
      error: (error: unknown) => this.mensaje.set(describe(error))
    });
  }

  cargarTiposDisponibles(): void {
    this.admin.tiposEmisorDisponibles().subscribe({
      next: (tipos) => this.tiposDisponibles.set(tipos),
      error: () => this.tiposDisponibles.set([])
    });
  }

  abrirAlta(): void {
    this.nuevoNombre.set('');
    this.tiposNuevos.set([...this.tipos()]);
    this.creado.set(undefined);
    this.mensaje.set(undefined);
    this.dialogo.set(true);
  }

  toggleTipoNuevo(tipo: string): void {
    const actuales = this.tiposNuevos();
    if (actuales.includes(tipo)) {
      this.tiposNuevos.set(actuales.filter((t) => t !== tipo));
    } else {
      this.tiposNuevos.set([...actuales, tipo]);
    }
  }

  cerrarDialogo(): void {
    this.dialogo.set(false);
    this.creado.set(undefined);
  }

  crear(): void {
    const nombre = this.nuevoNombre().trim();
    if (!nombre) {
      return;
    }
    this.ocupado.set(true);
    this.admin
      .crearEmisor({
        nombre,
        tipos:
          this.tiposNuevos().length > 0 ? this.tiposNuevos() : this.tipos(),
        accountId: this.cuenta()
      })
      .subscribe({
        next: (emisor) => {
          this.creado.set({ nombre: emisor.nombre, token: emisor.token });
          this.nuevoNombre.set('');
          this.mensaje.set(undefined);
          this.ocupado.set(false);
          this.cargar();
        },
        error: (error: unknown) => {
          this.mensaje.set(describe(error));
          this.ocupado.set(false);
        }
      });
  }

  borrar(nombre: string): void {
    this.admin.borrarEmisor(nombre).subscribe({
      next: () => {
        if (this.creado()?.nombre === nombre) {
          this.creado.set(undefined);
        }
        this.cargar();
      },
      error: (error: unknown) => this.mensaje.set(describe(error))
    });
  }

  abrirEdicion(emisor: Emisor): void {
    this.editando.set(emisor);
    this.tiposEditados.set([...emisor.tipos]);
    this.mensaje.set(undefined);
    this.dialogoEdicion.set(true);
  }

  cerrarEdicion(): void {
    this.dialogoEdicion.set(false);
    this.editando.set(undefined);
  }

  toggleTipo(tipo: string): void {
    const actuales = this.tiposEditados();
    if (actuales.includes(tipo)) {
      this.tiposEditados.set(actuales.filter((t) => t !== tipo));
    } else {
      this.tiposEditados.set([...actuales, tipo]);
    }
  }

  guardarTipos(): void {
    const emisor = this.editando();
    if (!emisor || this.tiposEditados().length === 0) {
      return;
    }
    this.ocupado.set(true);
    this.admin
      .actualizarTiposEmisor(emisor.nombre, this.tiposEditados())
      .subscribe({
        next: () => {
          this.ocupado.set(false);
          this.cerrarEdicion();
          this.cargar();
        },
        error: (error: unknown) => {
          this.mensaje.set(describe(error));
          this.ocupado.set(false);
        }
      });
  }
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
