import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Catalogo de iconos.
 *
 * Se pinta una sola vez en el armazon y cada `<pt-icon>` apunta aquí con
 * `<use>`. Sale más barato que repetir el trazo en cada plantilla y evita
 * cargar una libreria de iconos entera para las veinte que se usan.
 *
 * Todos los trazos están dibujados en una caja de 24 por 24.
 */
@Component({
  selector: 'pt-icon-sprite',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg aria-hidden="true" class="hidden">
      <symbol id="i-panel" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </symbol>
      <symbol id="i-tareas" viewBox="0 0 24 24">
        <path d="m3 7 2 2 3-3" />
        <path d="m3 16 2 2 3-3" />
        <path d="M12 8h9" />
        <path d="M12 17h9" />
      </symbol>
      <symbol id="i-agenda" viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 3v4" />
        <path d="M16 3v4" />
      </symbol>
      <symbol id="i-monitoreo" viewBox="0 0 24 24">
        <path d="M3 12h4l2.5-7 4 14L16 12h5" />
      </symbol>
      <symbol id="i-crm" viewBox="0 0 24 24">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        <path d="M3 12h18" />
      </symbol>
      <symbol id="i-equipo" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <path d="M16.5 5.6a3.2 3.2 0 0 1 0 5.8" />
        <path d="M18 14.5a6 6 0 0 1 3 5.5" />
      </symbol>
      <symbol id="i-ajustes" viewBox="0 0 24 24">
        <path d="M4 6h10" />
        <path d="M18 6h2" />
        <path d="M4 12h4" />
        <path d="M12 12h8" />
        <path d="M4 18h10" />
        <path d="M18 18h2" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="16" cy="18" r="2" />
      </symbol>
      <symbol id="i-refrescar" viewBox="0 0 24 24">
        <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
        <path d="M21 3v5h-5" />
      </symbol>
      <symbol id="i-sol" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m5 5 1.5 1.5" />
        <path d="m17.5 17.5 1.5 1.5" />
        <path d="m19 5-1.5 1.5" />
        <path d="M6.5 17.5 5 19" />
      </symbol>
      <symbol id="i-luna" viewBox="0 0 24 24">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </symbol>
      <symbol id="i-externo" viewBox="0 0 24 24">
        <path d="M14 4h6v6" />
        <path d="M20 4 11 13" />
        <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
      </symbol>
      <symbol id="i-alerta" viewBox="0 0 24 24">
        <path
          d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </symbol>
      <symbol id="i-ok" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </symbol>
      <symbol id="i-reloj" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5.2l3.4 2" />
      </symbol>
      <symbol id="i-mas" viewBox="0 0 24 24">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </symbol>
      <symbol id="i-basura" viewBox="0 0 24 24">
        <path d="M3.5 6h17" />
        <path d="M18.5 6v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6" />
        <path d="M9.5 6V4.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V6" />
      </symbol>
      <symbol id="i-buscar" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </symbol>
      <symbol id="i-video" viewBox="0 0 24 24">
        <rect x="2.5" y="6" width="12" height="12" rx="2" />
        <path d="m14.5 12 6-3.5v7z" />
      </symbol>
      <symbol id="i-lugar" viewBox="0 0 24 24">
        <path
          d="M19.5 10.5c0 5.5-7.5 10.5-7.5 10.5S4.5 16 4.5 10.5a7.5 7.5 0 0 1 15 0z" />
        <circle cx="12" cy="10.5" r="2.5" />
      </symbol>
      <symbol id="i-bandeja" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 13h5l1.5 2.5h5L16 13h5" />
      </symbol>
      <symbol id="i-menu" viewBox="0 0 24 24">
        <path d="M4 6h16" />
        <path d="M4 12h16" />
        <path d="M4 18h16" />
      </symbol>
      <symbol id="i-cerrar" viewBox="0 0 24 24">
        <path d="m6 6 12 12" />
        <path d="m18 6-12 12" />
      </symbol>
      <symbol id="i-monitor" viewBox="0 0 24 24">
        <rect x="2.5" y="4" width="19" height="13" rx="2" />
        <path d="M9 21h6" />
        <path d="M12 17v4" />
      </symbol>
      <symbol id="i-pausa" viewBox="0 0 24 24">
        <rect x="7" y="5" width="3.5" height="14" rx="1" />
        <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
      </symbol>
      <symbol id="i-reproducir" viewBox="0 0 24 24">
        <path d="M8 5.5v13l11-6.5z" />
      </symbol>
      <symbol id="i-anterior" viewBox="0 0 24 24">
        <path d="m14 6-6 6 6 6" />
      </symbol>
      <symbol id="i-siguiente" viewBox="0 0 24 24">
        <path d="m10 6 6 6-6 6" />
      </symbol>
      <symbol id="i-expandir" viewBox="0 0 24 24">
        <path d="M9 4H4v5" />
        <path d="M15 4h5v5" />
        <path d="M15 20h5v-5" />
        <path d="M9 20H4v-5" />
      </symbol>
    </svg>
  `,
  styles: `
    svg {
      display: none;
    }
  `
})
export class IconSpriteComponent {}
