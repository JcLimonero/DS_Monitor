import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, combineLatest, map, of } from 'rxjs';
import {
  AREA_PERMISO_LABEL,
  NIVEL_ACCESO_LABEL,
  type AreaPermiso,
  type NivelAcceso,
  type RolCrm,
  type UsuarioCrm
} from '../../core/models/crm-nativo.model';
import { CrmService } from '../../core/sources/gateway/crm.service';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';
import { PageHeaderComponent } from '../../ui/page-header.component';

@Component({
  selector: 'pt-roles',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent, IconComponent, PageHeaderComponent],
  template: `
    <pt-page-header title="Usuarios y Roles" />

    @if (crm.cargando()) {
      <div class="loading-message">Cargando...</div>
    } @else if (!crm.esDirector()) {
      <pt-empty-state
        icon="usuario"
        title="Solo Director"
        hint="Solo el Director puede administrar usuarios y roles." />
    } @else if (error()) {
      <pt-empty-state icon="alerta" title="Error" [hint]="error()!" />
    } @else {
      <div class="contenido">
        <!-- Usuarios -->
        <section class="card seccion">
          <div class="seccion-header">
            <h3 class="seccion-titulo">
              Usuarios
              <span class="badge">{{ usuarios().length }}</span>
            </h3>
          </div>
          @if (usuarios().length === 0) {
            <p class="sin-datos">Sin usuarios registrados</p>
          } @else {
            <div class="tabla">
              <div class="tabla-header">
                <span class="col-nombre">Nombre</span>
                <span class="col-correo">Correo</span>
                <span class="col-roles">Roles</span>
                <span class="col-estado">Estado</span>
              </div>
              @for (usuario of usuarios(); track usuario.id) {
                <div class="tabla-fila">
                  <span class="col-nombre">{{ usuario.nombre }}</span>
                  <span class="col-correo">{{ usuario.correo }}</span>
                  <span class="col-roles">
                    @for (rolId of usuario.roles; track rolId) {
                      <span class="chip">{{ rolNombre(rolId) }}</span>
                    }
                  </span>
                  <span class="col-estado">
                    <span
                      class="indicador"
                      [class.activo]="usuario.activo"></span>
                    {{ usuario.activo ? 'Activo' : 'Inactivo' }}
                  </span>
                </div>
              }
            </div>
          }
        </section>

        <!-- Roles -->
        <section class="card seccion">
          <div class="seccion-header">
            <h3 class="seccion-titulo">
              Roles
              <span class="badge">{{ roles().length }}</span>
            </h3>
          </div>
          @if (roles().length === 0) {
            <p class="sin-datos">Sin roles definidos</p>
          } @else {
            <div class="roles-lista">
              @for (rol of roles(); track rol.id) {
                <div class="rol-card">
                  <div class="rol-header">
                    <span class="rol-nombre">
                      {{ rol.nombre }}
                      @if (rol.esSistema) {
                        <span class="chip chip--sistema">Sistema</span>
                      }
                    </span>
                    @if (rol.descripcion) {
                      <p class="rol-desc">{{ rol.descripcion }}</p>
                    }
                  </div>
                  <div class="permisos">
                    @for (area of areas; track area) {
                      <div class="permiso">
                        <span class="permiso-area">{{ areaLabel[area] }}</span>
                        <span
                          class="permiso-nivel"
                          [class.ninguno]="nivelDeRol(rol, area) === 'ninguno'">
                          {{ nivelLabel[nivelDeRol(rol, area)] }}
                        </span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: var(--space-4);
    }

    .loading-message {
      text-align: center;
      color: var(--text-secondary);
      padding: var(--space-8);
    }

    .contenido {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
    }

    .seccion {
      padding: var(--space-4);
    }

    .seccion-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--space-3);
    }

    .seccion-titulo {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .badge {
      background: var(--surface-secondary);
      color: var(--text-secondary);
      font-size: 0.75rem;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .sin-datos {
      color: var(--text-secondary);
      font-style: italic;
      margin: 0;
    }

    .tabla {
      display: flex;
      flex-direction: column;
    }

    .tabla-header,
    .tabla-fila {
      display: grid;
      grid-template-columns: 1fr 1.5fr 1.5fr 100px;
      gap: var(--space-3);
      padding: var(--space-2) 0;
      align-items: center;
    }

    .tabla-header {
      font-size: 0.75rem;
      color: var(--text-tertiary);
      text-transform: uppercase;
      border-bottom: 1px solid var(--border);
    }

    .tabla-fila {
      border-bottom: 1px solid var(--border);
    }

    .tabla-fila:last-child {
      border-bottom: none;
    }

    .col-nombre {
      font-weight: 500;
    }

    .col-correo {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }

    .col-roles {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }

    .col-estado {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 0.875rem;
    }

    .indicador {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-tertiary);
    }

    .indicador.activo {
      background: var(--accent-green);
    }

    .roles-lista {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: var(--space-3);
    }

    .rol-card {
      background: var(--surface-secondary);
      border-radius: var(--radius);
      padding: var(--space-3);
    }

    .rol-header {
      margin-bottom: var(--space-3);
    }

    .rol-nombre {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 600;
      margin-bottom: var(--space-1);
    }

    .rol-desc {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin: 0;
    }

    .permisos {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }

    .permiso {
      display: flex;
      justify-content: space-between;
      font-size: 0.875rem;
      padding: var(--space-1) 0;
      border-bottom: 1px solid var(--border);
    }

    .permiso:last-child {
      border-bottom: none;
    }

    .permiso-area {
      color: var(--text-secondary);
    }

    .permiso-nivel {
      font-weight: 500;
    }

    .permiso-nivel.ninguno {
      color: var(--text-tertiary);
    }

    .chip--sistema {
      --chip-bg: var(--accent-blue-bg);
      --chip-text: var(--accent-blue);
      font-size: 0.625rem;
    }
  `
})
export class RolesComponent {
  readonly crm = inject(CrmService);

  readonly areaLabel = AREA_PERMISO_LABEL;
  readonly nivelLabel = NIVEL_ACCESO_LABEL;
  readonly areas: AreaPermiso[] = [
    'clientes',
    'proyectos',
    'cotizaciones',
    'cobranza',
    'costos',
    'desarrollo',
    'actividades'
  ];

  readonly error = signal<string | null>(null);

  private readonly datos$ = combineLatest([
    this.crm.obtenerRoles(),
    this.crm.obtenerUsuarios()
  ]).pipe(
    map(([roles, usuarios]) => ({ roles, usuarios })),
    catchError((err) => {
      this.error.set(err.message || 'Error al cargar datos');
      return of({ roles: [], usuarios: [] });
    })
  );

  private readonly datos = toSignal(this.datos$, {
    initialValue: { roles: [], usuarios: [] }
  });

  readonly roles = computed(() => this.datos().roles);
  readonly usuarios = computed(() => this.datos().usuarios);

  rolNombre(rolId: string): string {
    const rol = this.roles().find((r) => r.id === rolId);
    return rol?.nombre ?? rolId;
  }

  nivelDeRol(rol: RolCrm, area: AreaPermiso): NivelAcceso {
    return rol.permisos[area] ?? 'ninguno';
  }
}
