import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SesionService } from '../../core/acceso/sesion.service';
import { BrandLogoComponent } from '../../ui/brand-logo.component';

/**
 * La puerta del portal: correo, código que llega por correo, y adentro.
 */
@Component({
  selector: 'pt-acceso',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BrandLogoComponent],
  templateUrl: './acceso.component.html'
})
export class AccesoComponent {
  private readonly sesion = inject(SesionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly correo = signal('');
  readonly codigo = signal('');
  readonly paso = signal<'correo' | 'codigo'>('correo');
  readonly ocupado = signal(false);
  /** Cuenta regresiva antes de poder reenviar, para no disparar correos en cadena. */
  readonly segundosParaReenviar = signal(0);
  private cuenta: ReturnType<typeof setInterval> | undefined;
  readonly mensaje = signal<{ ok: boolean; texto: string } | undefined>(
    undefined
  );
  readonly sinPuente = !this.sesion.disponible;

  pedirCodigo(): void {
    const correo = this.correo().trim();
    if (!correo) {
      return;
    }
    // Lo que no parece correo se prueba como clave maestra: si el puente la
    // reconoce, entra sin código.
    if (
      !correo.includes('@') ||
      (/@[A-Za-z]+$/.test(correo) && !correo.includes('.'))
    ) {
      this.codigo.set(correo);
      this.entrar();
      return;
    }
    this.ocupado.set(true);
    this.sesion.pedirCodigo(correo).subscribe({
      next: (respuesta) => {
        this.mensaje.set({ ok: true, texto: respuesta.mensaje });
        this.paso.set('codigo');
        this.codigo.set('');
        this.ocupado.set(false);
        this.iniciarCuenta();
      },
      error: (error: unknown) => {
        this.mensaje.set({ ok: false, texto: describe(error) });
        this.ocupado.set(false);
      }
    });
  }

  entrar(): void {
    this.ocupado.set(true);
    this.sesion.entrar(this.correo().trim(), this.codigo()).subscribe({
      next: () => {
        const volver = this.route.snapshot.queryParamMap.get('volver');
        void this.router.navigateByUrl(
          volver && !volver.startsWith('/acceso') ? volver : '/panel'
        );
      },
      error: (error: unknown) => {
        this.mensaje.set({ ok: false, texto: describe(error) });
        this.ocupado.set(false);
      }
    });
  }

  /** Vuelve a mandar un código nuevo al mismo correo. */
  reenviar(): void {
    if (this.segundosParaReenviar() > 0) {
      return;
    }
    this.pedirCodigo();
  }

  otroCorreo(): void {
    this.paso.set('correo');
    this.codigo.set('');
    this.mensaje.set(undefined);
  }

  private iniciarCuenta(): void {
    clearInterval(this.cuenta);
    this.segundosParaReenviar.set(30);
    this.cuenta = setInterval(() => {
      this.segundosParaReenviar.update((s) => s - 1);
      if (this.segundosParaReenviar() <= 0) {
        clearInterval(this.cuenta);
      }
    }, 1000);
  }
}

function describe(error: unknown): string {
  const http = error as {
    error?: { error?: string };
    status?: number;
    message?: string;
  };
  if (http?.error?.error) {
    return http.error.error;
  }
  if (http?.status === 0) {
    return 'No se pudo llegar al servidor.';
  }
  return http?.message ?? String(error);
}
