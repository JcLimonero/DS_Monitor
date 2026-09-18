import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPRESAS, Propuesta } from '../../core/ia/ia.models';
import { IaService, describirError } from '../../core/ia/ia.service';
import { TASK_PRIORITY_LABEL, TaskPriority } from '../../core/models';
import { PortalStore } from '../../core/state/portal.store';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

/** El reconocimiento de voz del navegador (Chrome, Edge, Safari). */
type Reconocedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

function crearReconocedor(): Reconocedor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: new () => Reconocedor;
    webkitSpeechRecognition?: new () => Reconocedor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : undefined;
}

/**
 * Dictar: hablas (o escribes) lo que hay que hacer y el puente lo convierte
 * en pendientes con empresa, prioridad, fecha y responsable. Lo que entiende
 * se enseña como propuestas editables; nada se guarda hasta "Agregar".
 *
 * La voz la reconoce el navegador (Web Speech API, es-MX); donde no exista,
 * se escribe. La interpretación la hace la IA del puente si está activa, y
 * si no, un intérprete por reglas más modesto.
 */
@Component({
  selector: 'pt-dictado',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent, PageHeaderComponent],
  templateUrl: './dictado.component.html'
})
export class DictadoComponent implements OnDestroy {
  readonly ia = inject(IaService);
  private readonly store = inject(PortalStore);
  private reconocedor: Reconocedor | undefined;

  readonly priorityLabel = TASK_PRIORITY_LABEL;
  readonly priorities: TaskPriority[] = ['urgente', 'alta', 'media', 'baja'];
  readonly empresas = EMPRESAS;
  readonly hayVoz = !!(
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: unknown })
      .webkitSpeechRecognition
  );

  readonly texto = signal('');
  readonly parcial = signal('');
  readonly escuchando = signal(false);
  readonly procesando = signal(false);
  readonly guardando = signal(false);
  readonly conIa = signal<boolean | undefined>(undefined);
  readonly propuestas = signal<Propuesta[] | undefined>(undefined);
  readonly elegidas = signal<boolean[]>([]);
  readonly mensaje = signal<string | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);

  readonly equipo = this.ia.equipo;
  readonly puedeProcesar = computed(
    () => this.texto().trim().length > 0 && !this.procesando()
  );
  readonly cuantasElegidas = computed(
    () => this.elegidas().filter((x) => x).length
  );

  constructor() {
    this.ia.cargarEquipo();
  }

  ngOnDestroy(): void {
    this.reconocedor?.stop();
  }

  alternarVoz(): void {
    if (this.escuchando()) {
      this.reconocedor?.stop();
      return;
    }
    const r = crearReconocedor();
    if (!r) {
      this.error.set('Este navegador no reconoce voz; escribe el dictado.');
      return;
    }
    this.reconocedor = r;
    r.lang = 'es-MX';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let parcial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const frase = res?.[0]?.transcript ?? '';
        if (res?.isFinal) {
          this.texto.update(
            (t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}${frase.trim()}`
          );
        } else {
          parcial += frase;
        }
      }
      this.parcial.set(parcial);
    };
    r.onerror = (e) => {
      this.error.set(
        e.error === 'not-allowed'
          ? 'El navegador no dio permiso al micrófono.'
          : `No se pudo escuchar (${e.error}).`
      );
      this.escuchando.set(false);
    };
    r.onend = () => {
      this.escuchando.set(false);
      this.parcial.set('');
    };
    this.error.set(undefined);
    this.escuchando.set(true);
    r.start();
  }

  procesar(): void {
    if (!this.puedeProcesar()) {
      return;
    }
    this.reconocedor?.stop();
    this.procesando.set(true);
    this.error.set(undefined);
    this.mensaje.set(undefined);
    this.ia.dictar(this.texto()).subscribe({
      next: (r) => {
        const calendario = this.ia.calendarios()[0];
        this.propuestas.set(
          r.propuestas.map((p) =>
            p.esJunta && p.venceEn && calendario && !p.agendarEn
              ? { ...p, agendarEn: calendario.id }
              : p
          )
        );
        this.elegidas.set(r.propuestas.map(() => true));
        this.conIa.set(r.conIa);
        this.procesando.set(false);
        if (r.propuestas.length === 0) {
          this.mensaje.set('No encontré nada que convertir en pendiente.');
        }
      },
      error: (e: unknown) => {
        this.error.set(describirError(e));
        this.procesando.set(false);
      }
    });
  }

  elegir(i: number, valor: boolean): void {
    this.elegidas.update((l) => l.map((x, j) => (j === i ? valor : x)));
  }

  cambiar(i: number, cambio: Partial<Propuesta>): void {
    this.propuestas.update((lista) =>
      (lista ?? []).map((p, j) => (j === i ? { ...p, ...cambio } : p))
    );
  }

  /** El selector de responsable manda el correo o id; se traduce a persona. */
  asignar(i: number, quien: string): void {
    const persona = this.equipo().find(
      (p) => p.email === quien || p.id === quien
    );
    this.cambiar(i, { persona, responsable: persona?.name });
  }

  /** El input datetime-local entrega "2026-09-22T12:00" en hora local. */
  fechaLocal(iso: string | undefined): string {
    if (!iso) {
      return '';
    }
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  ponerFecha(i: number, local: string): void {
    this.cambiar(i, {
      venceEn: local ? new Date(local).toISOString() : undefined
    });
  }

  guardar(): void {
    const lista = (this.propuestas() ?? []).filter(
      (_, i) => this.elegidas()[i]
    );
    if (lista.length === 0) {
      return;
    }
    this.guardando.set(true);
    this.error.set(undefined);
    this.ia.aceptarDictado(lista).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.mensaje.set(
          `${r.agregados} ${r.agregados === 1 ? 'pendiente agregado' : 'pendientes agregados'}.${r.avisos.length ? ` ${r.avisos.join(' ')}` : ''}`
        );
        this.propuestas.set(undefined);
        this.texto.set('');
        this.store.refreshTasks();
      },
      error: (e: unknown) => {
        this.error.set(describirError(e));
        this.guardando.set(false);
      }
    });
  }

  limpiar(): void {
    this.reconocedor?.stop();
    this.texto.set('');
    this.parcial.set('');
    this.propuestas.set(undefined);
    this.mensaje.set(undefined);
    this.error.set(undefined);
  }
}
