/**
 * Mantiene el monitor despierto mientras corre el carrusel.
 *
 * Sin esto el protector de pantalla del sistema tapa el tablero a los diez
 * minutos, que es justo lo contrario de lo que se quiere de una pantalla fija.
 *
 * La API de Wake Lock no existe en todos los navegadores y el permiso se pierde
 * cuando la pestaña pasa a segundo plano, asi que se vuelve a pedir al regresar
 * y cualquier fallo se ignora: el carrusel funciona igual, nada mas que el
 * sistema podra apagar la pantalla.
 */

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockDisponible(): WakeLockLike | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
}

export class PantallaEncendida {
  private sentinel?: WakeLockSentinelLike;
  private readonly alVolver = () => {
    if (document.visibilityState === 'visible') {
      void this.pedir();
    }
  };

  /** Pide el permiso y lo renueva cada vez que la pestaña vuelve al frente. */
  async iniciar(): Promise<void> {
    document.addEventListener('visibilitychange', this.alVolver);
    await this.pedir();
  }

  async detener(): Promise<void> {
    document.removeEventListener('visibilitychange', this.alVolver);
    try {
      await this.sentinel?.release();
    } catch {
      // Ya estaba liberado o el navegador lo quito solo.
    }
    this.sentinel = undefined;
  }

  private async pedir(): Promise<void> {
    const wakeLock = wakeLockDisponible();
    if (!wakeLock || this.sentinel) {
      return;
    }
    try {
      const sentinel = await wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        this.sentinel = undefined;
      });
      this.sentinel = sentinel;
    } catch {
      // El navegador puede negarlo (pestaña oculta, politica del equipo).
    }
  }
}
