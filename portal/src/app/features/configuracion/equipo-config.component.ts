import { SemanaConfigComponent } from '../ia/semana-config.component';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Person } from '../../core/models';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { ConfiguracionBase } from './configuracion-base';

type DialogoPersona = { modo: 'alta' } | { modo: 'edicion'; indice: number };

/** El equipo, quién puede entrar, y los emisores que alimentan la API. */
@Component({
  selector: 'pt-equipo-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SemanaConfigComponent,
    DialogoComponent,
    FormsModule,
    IconComponent
  ],
  templateUrl: './equipo-config.component.html'
})
export class EquipoConfigComponent extends ConfiguracionBase {
  readonly dialogo = signal<DialogoPersona | undefined>(undefined);
  readonly borrador = signal<Person>(personaVacia());

  readonly tituloDialogo = computed(() =>
    this.dialogo()?.modo === 'alta' ? 'Agregar persona' : 'Editar persona'
  );

  constructor() {
    super();
    this.cargarEstatusProg();
    this.cargarModelosIa();
  }

  abrirAlta(): void {
    this.borrador.set(personaVacia());
    this.dialogo.set({ modo: 'alta' });
  }

  abrirEdicion(i: number): void {
    const p = this.equipoDraft()[i];
    if (!p) {
      return;
    }
    this.borrador.set({ ...p });
    this.dialogo.set({ modo: 'edicion', indice: i });
  }

  cerrarDialogo(): void {
    this.dialogo.set(undefined);
  }

  cambiarBorrador(cambio: Partial<Person>): void {
    this.borrador.update((p) => ({ ...p, ...cambio }));
  }

  confirmarDialogo(): void {
    const b = this.borrador();
    if (!b.name.trim()) {
      this.equipoMensaje.set({ ok: false, mensaje: 'Falta el nombre.' });
      return;
    }
    const d = this.dialogo();
    if (!d) {
      return;
    }
    const persona: Person = {
      ...b,
      name: b.name.trim(),
      email: b.email?.trim() || undefined,
      role: b.role?.trim() || undefined,
      id: b.email?.trim() || b.name.trim().toLowerCase()
    };
    if (d.modo === 'alta') {
      this.equipoDraft.update((lista) => [...lista, persona]);
    } else {
      this.updatePersona(d.indice, persona);
    }
    this.dialogo.set(undefined);
    this.saveEquipo();
  }

  quitarPersona(i: number): void {
    const p = this.equipoDraft()[i];
    if (!p) {
      return;
    }
    if (!confirm(`¿Quitar a ${p.name || 'esta persona'} del equipo?`)) {
      return;
    }
    this.removePersona(i);
    this.saveEquipo();
  }

  resumen(p: Person): string {
    const partes: string[] = [];
    if (p.email) {
      partes.push(p.email);
    }
    if (p.role) {
      partes.push(p.role);
    }
    if (p.pedirEstatus) {
      partes.push('pide estatus');
    }
    return partes.join(' · ');
  }
}

function personaVacia(): Person {
  return { id: '', name: '', email: '', role: '' };
}
