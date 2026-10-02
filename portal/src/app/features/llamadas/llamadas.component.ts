import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LlamadaArchivada } from '../../core/models';
import {
  EstadoLlamadas,
  PuenteAdminService,
  ResumenLlamadas
} from '../../core/sources/gateway/puente-admin.service';
import {
  duracionLlamada,
  filtrarLlamadas,
  resumenParticipantes
} from '../../core/util/llamadas.util';
import { plural } from '../../core/util/text.util';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';
import { DayPipe, RelativePipe, TimePipe } from '../../ui/portal.pipes';

/**
 * Llamadas: las conversaciones de Fireflies que el puente ya guardó como
 * Google Doc en Drive, con la liga para abrir cada una. Lo que se archiva se
 * borra de Fireflies para liberar espacio (el interruptor está aquí mismo).
 */
@Component({
  selector: 'pt-llamadas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    PageHeaderComponent,
    RouterLink,
    DayPipe,
    RelativePipe,
    TimePipe
  ],
  templateUrl: './llamadas.component.html'
})
export class LlamadasComponent {
  private readonly admin = inject(PuenteAdminService);

  readonly plural = plural;
  readonly disponible = this.admin.disponible;
  readonly llamadas = signal<LlamadaArchivada[]>([]);
  readonly estado = signal<EstadoLlamadas | undefined>(undefined);
  readonly cargando = signal(false);
  readonly cargada = signal(false);
  readonly error = signal<string | undefined>(undefined);
  readonly archivando = signal(false);
  readonly guardandoConfig = signal(false);
  readonly resumen = signal<ResumenLlamadas | undefined>(undefined);
  readonly busqueda = signal('');

  readonly visibles = computed(() =>
    filtrarLlamadas(this.llamadas(), this.busqueda())
  );

  readonly subtitle = computed(() => {
    const total = this.llamadas().length;
    if (!this.cargada()) {
      return 'Conversaciones de Fireflies guardadas en tu Drive';
    }
    const sinBorrar = this.llamadas().filter(
      (l) => !l.borradaDeFireflies
    ).length;
    return sinBorrar > 0
      ? `${plural(total, 'llamada')} · ${sinBorrar} aún en Fireflies`
      : plural(total, 'llamada');
  });

  /** Lo que impide archivar, dicho en una frase; vacío si todo está listo. */
  readonly falta = computed(() => {
    const e = this.estado();
    if (!e) {
      return undefined;
    }
    if (!e.fireflies) {
      return 'Falta la API key de Fireflies (Integraciones → Fireflies).';
    }
    if (!e.google) {
      return 'Falta conectar una cuenta de Google (Integraciones → Correo → Conectar con Google) para guardar en Drive.';
    }
    return undefined;
  });

  readonly puedeArchivar = computed(
    () =>
      this.disponible &&
      !this.archivando() &&
      !this.estado()?.enCurso &&
      !this.falta()
  );

  constructor() {
    this.cargar();
  }

  duracion(llamada: LlamadaArchivada): string {
    return duracionLlamada(llamada.duracionMin);
  }

  participantes(llamada: LlamadaArchivada): string {
    return resumenParticipantes(llamada.participantes);
  }

  cargar(): void {
    if (!this.disponible) {
      this.cargada.set(true);
      return;
    }
    this.cargando.set(true);
    this.error.set(undefined);
    this.admin.estadoLlamadas().subscribe({
      next: (estado) => this.estado.set(estado),
      error: (e: unknown) => this.error.set(describe(e))
    });
    this.admin.llamadas().subscribe({
      next: (lista) => {
        this.llamadas.set(lista);
        this.cargando.set(false);
        this.cargada.set(true);
      },
      error: (e: unknown) => {
        this.error.set(describe(e));
        this.cargando.set(false);
        this.cargada.set(true);
      }
    });
  }

  archivar(): void {
    if (!this.puedeArchivar()) {
      return;
    }
    this.archivando.set(true);
    this.resumen.set(undefined);
    this.admin.archivarLlamadas().subscribe({
      next: (resumen) => {
        this.archivando.set(false);
        this.resumen.set(resumen);
        this.cargar();
      },
      error: (e: unknown) => {
        this.archivando.set(false);
        this.error.set(describe(e));
      }
    });
  }

  cambiarBorrado(valor: boolean): void {
    const actual = this.estado();
    if (!actual || this.guardandoConfig()) {
      return;
    }
    this.guardandoConfig.set(true);
    this.admin.guardarConfigLlamadas({ borrarDeFireflies: valor }).subscribe({
      next: (r) => {
        this.estado.set({ ...actual, borrarDeFireflies: r.borrarDeFireflies });
        this.guardandoConfig.set(false);
      },
      error: (e: unknown) => {
        this.error.set(describe(e));
        this.guardandoConfig.set(false);
      }
    });
  }
}

function describe(error: unknown): string {
  const http = error as { error?: { error?: string }; message?: string };
  return http?.error?.error ?? http?.message ?? String(error);
}
