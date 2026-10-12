import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CrmCliente,
  CrmProyecto,
  JuntaRag,
  LlamadaArchivada
} from '../../core/models';
import { CrmService } from '../../core/sources/gateway/crm.service';
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

interface FormaAsignacion {
  clienteId: string;
  proyectoId: string;
  clienteNombre: string;
  proyectoNombre: string;
}

const FORMA_VACIA: FormaAsignacion = {
  clienteId: '',
  proyectoId: '',
  clienteNombre: '',
  proyectoNombre: ''
};

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
  private readonly crm = inject(CrmService);

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
  /** Primera pasada: subir los Docs sin borrar nada de Fireflies. */
  readonly soloArchivar = signal(false);
  readonly sinAsignar = signal<JuntaRag[]>([]);
  readonly clientes = signal<CrmCliente[]>([]);
  readonly proyectos = signal<CrmProyecto[]>([]);
  readonly formas = signal<Record<string, FormaAsignacion>>({});
  readonly asignando = signal<string | undefined>(undefined);

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
    this.admin.juntasSinAsignar().subscribe({
      next: (lista) => {
        this.sinAsignar.set(lista);
        if (lista.some((j) => !j.esItech) && this.clientes().length === 0) {
          this.crm.obtenerClientes().subscribe({
            next: (clientes) => this.clientes.set(clientes),
            error: () => undefined
          });
          this.crm.obtenerProyectos().subscribe({
            next: (proyectos) => this.proyectos.set(proyectos),
            error: () => undefined
          });
        }
      },
      error: () => this.sinAsignar.set([])
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
    this.admin
      .archivarLlamadas({ soloArchivar: this.soloArchivar() })
      .subscribe({
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

  forma(id: string): FormaAsignacion {
    return this.formas()[id] ?? FORMA_VACIA;
  }

  poner(id: string, campo: keyof FormaAsignacion, valor: string): void {
    const actual = this.forma(id);
    this.formas.update((todas) => ({
      ...todas,
      [id]: {
        ...actual,
        [campo]: valor,
        ...(campo === 'clienteId' ? { proyectoId: '' } : {})
      }
    }));
  }

  proyectosDe(clienteId: string): CrmProyecto[] {
    return this.proyectos().filter(
      (p) => p.clienteId === clienteId && p.estado !== 'cancelado'
    );
  }

  puedeAsignar(junta: JuntaRag): boolean {
    if (this.asignando()) {
      return false;
    }
    const f = this.forma(junta.id);
    if (junta.esItech) {
      return (
        f.clienteNombre.trim().length >= 2 &&
        f.proyectoNombre.trim().length >= 2
      );
    }
    return !!f.clienteId && !!f.proyectoId;
  }

  asignar(junta: JuntaRag): void {
    if (!this.puedeAsignar(junta)) {
      return;
    }
    const f = this.forma(junta.id);
    this.asignando.set(junta.id);
    this.error.set(undefined);
    this.admin
      .asignarJunta(
        junta.id,
        junta.esItech
          ? {
              clienteNombre: f.clienteNombre.trim(),
              proyectoNombre: f.proyectoNombre.trim()
            }
          : { clienteId: f.clienteId, proyectoId: f.proyectoId }
      )
      .subscribe({
        next: () => {
          this.asignando.set(undefined);
          this.cargar();
        },
        error: (e: unknown) => {
          this.asignando.set(undefined);
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
