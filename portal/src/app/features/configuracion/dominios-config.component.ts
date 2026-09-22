import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dominio } from '../../core/sources/gateway/puente-admin.service';
import { DialogoComponent } from '../../ui/dialogo.component';
import { IconComponent } from '../../ui/icon.component';
import { ConfiguracionBase } from './configuracion-base';

type DialogoDominio = { modo: 'alta' } | { modo: 'edicion'; indice: number };

/** Los dominios registrados: vencimiento y costo. */
@Component({
  selector: 'pt-dominios-config',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogoComponent, FormsModule, IconComponent],
  templateUrl: './dominios-config.component.html'
})
export class DominiosConfigComponent extends ConfiguracionBase {
  readonly dialogo = signal<DialogoDominio | undefined>(undefined);
  readonly borrador = signal<Dominio>(dominioVacio());

  readonly tituloDialogo = computed(() =>
    this.dialogo()?.modo === 'alta' ? 'Agregar dominio' : 'Editar dominio'
  );

  abrirAlta(): void {
    this.borrador.set(dominioVacio());
    this.dialogo.set({ modo: 'alta' });
  }

  abrirEdicion(i: number): void {
    const d = this.dominiosDraft()[i];
    if (!d) {
      return;
    }
    this.borrador.set({ ...d });
    this.dialogo.set({ modo: 'edicion', indice: i });
  }

  cerrarDialogo(): void {
    this.dialogo.set(undefined);
  }

  cambiarBorrador(cambio: Partial<Dominio>): void {
    this.borrador.update((d) => ({ ...d, ...cambio }));
  }

  confirmarDialogo(): void {
    const b = this.borrador();
    if (!b.nombre.trim() || !b.venceEn) {
      this.dominiosMensaje.set({
        ok: false,
        mensaje: 'Faltan el nombre y la fecha de vencimiento.'
      });
      return;
    }
    const d = this.dialogo();
    if (!d) {
      return;
    }
    const fila: Dominio = {
      ...b,
      nombre: b.nombre.trim(),
      registrador: b.registrador?.trim() || undefined,
      notas: b.notas?.trim() || undefined
    };
    if (d.modo === 'alta') {
      this.dominiosDraft.update((lista) => [...lista, fila]);
    } else {
      this.updateDominio(d.indice, fila);
    }
    this.dialogo.set(undefined);
    this.saveDominios();
  }

  quitarDominio(i: number): void {
    const d = this.dominiosDraft()[i];
    if (!d) {
      return;
    }
    if (!confirm(`¿Quitar ${d.nombre} de los dominios registrados?`)) {
      return;
    }
    this.removeDominio(i);
    this.saveDominios();
  }

  resumen(d: Dominio): string {
    const partes: string[] = [];
    if (d.registrador) {
      partes.push(d.registrador);
    }
    if (d.venceEn) {
      partes.push(`vence ${this.fechaCorta(d.venceEn)}`);
    }
    if (d.costo !== undefined && d.costo !== null && String(d.costo) !== '') {
      partes.push(`${d.costo} ${d.moneda ?? 'MXN'}`);
    }
    if (d.automatico) {
      partes.push('renovación automática');
    }
    return partes.join(' · ');
  }

  etiquetaDias(d: Dominio): string {
    if (!d.venceEn) {
      return '';
    }
    const n = this.diasPara(d.venceEn);
    if (n < 0) {
      return n === -1 ? 'vencido hace 1 día' : `vencido hace ${-n} días`;
    }
    return n === 1 ? '1 día' : `${n} días`;
  }

  claseDias(d: Dominio): string {
    if (!d.venceEn) {
      return 'text-ink-muted';
    }
    const n = this.diasPara(d.venceEn);
    if (n < 0) {
      return 'text-rose-600';
    }
    if (n <= 45) {
      return 'text-amber-600';
    }
    return 'text-emerald-600';
  }
}

function dominioVacio(): Dominio {
  return {
    nombre: '',
    registrador: 'Neubox',
    venceEn: '',
    costo: undefined,
    moneda: 'MXN',
    automatico: false
  };
}
