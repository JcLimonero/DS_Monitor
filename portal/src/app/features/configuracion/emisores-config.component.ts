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
import { IconComponent } from '../../ui/icon.component';
import { RelativePipe } from '../../ui/portal.pipes';

/**
 * La API para que otro sistema alimente un módulo: quién puede mandar (los
 * emisores), con qué token, y cómo se manda. El token se enseña una sola vez,
 * al crearlo.
 */
@Component({
  selector: 'pt-emisores-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, RelativePipe],
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

  readonly disponible = this.admin.disponible;
  readonly apiUrl = this.admin.apiUrl;
  readonly emisores = signal<Emisor[] | undefined>(undefined);
  readonly nuevoNombre = signal('');
  readonly creado = signal<{ nombre: string; token: string } | undefined>(
    undefined
  );
  readonly mensaje = signal<string | undefined>(undefined);
  readonly ocupado = signal(false);

  /** Solo los emisores que pueden mandar alguno de los tipos de este panel. */
  readonly propios = computed(() =>
    (this.emisores() ?? []).filter((e) =>
      e.tipos.some((t) => this.tipos().includes(t))
    )
  );

  readonly ejemplo = computed(() => {
    const tipo = this.tipos()[0] ?? 'pendientes';
    const cuerpo =
      tipo === 'equipo'
        ? '{"version":1,"datos":[{"nombre":"Ana Robles","correo":"ana@empresa.com","rol":"Frontend"}]}'
        : '{"version":1,"datos":[{"id":"482","titulo":"Reintentos del envío","prioridad":"alta","venceEn":"2026-09-20T13:00:00Z"}]}';
    return `curl -X POST ${this.apiUrl}/ingesta/${tipo} \\\\\n  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\\\\n  -d '${cuerpo}'`;
  });

  constructor() {
    if (this.disponible) {
      this.cargar();
    }
  }

  cargar(): void {
    this.admin.emisores().subscribe({
      next: (lista) => this.emisores.set(lista),
      error: (error: unknown) => this.mensaje.set(describe(error))
    });
  }

  crear(): void {
    const nombre = this.nuevoNombre().trim();
    if (!nombre) {
      return;
    }
    this.ocupado.set(true);
    this.admin
      .crearEmisor({ nombre, tipos: this.tipos(), accountId: this.cuenta() })
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
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
