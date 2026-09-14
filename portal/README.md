# Portal de pendientes

Una sola pantalla para lo que hoy está repartido en cinco lugares: los
pendientes propios, los del tablero de Ops y los del CRM, las juntas de las
distintas cuentas de correo, el estado de los sitios y servicios desplegados, y
el embudo de Odoo de Itech.

Es una aplicación aparte de `VGD_SF_Track`: vive en esta carpeta, se construye y
se despliega por su cuenta, y no toca nada de lo que ya está en producción.

## Estado actual

Las seis vistas están completas y navegables. **Todas las fuentes corren en modo
demostración**: los datos son inventados y los nombres de personas, clientes y
dominios también, porque este repositorio es público. Conectar una fuente real
no requiere tocar las vistas — se cambia una línea de configuración y se levanta
el backend puente. Ver *Conectar una fuente de verdad*.

Lo que todavía no hay: el backend puente, y pruebas automatizadas de los
selectores (`portal.selectors.ts`), que es donde vive la lógica que más se puede
romper en silencio.

## Arrancar

```bash
cd portal
npm install
npm start          # http://localhost:4200
```

Otros comandos:

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Construcción de producción en `dist/portal` |
| `npm run typecheck` | Revisa tipos sin generar nada |
| `npm run format` | Aplica Prettier |
| `npm run format:check` | Falla si algo no está formateado (es lo que corre en CI) |

## Las vistas

| Ruta | Qué muestra |
| --- | --- |
| `/panel` | Resumen del día: cifras, lo urgente, la agenda, el estado de las plataformas y lo que sigue en el CRM |
| `/pendientes` | Todos los pendientes juntos, agrupados por vencimiento, con filtros y alta rápida |
| `/agenda` | Las juntas de todas las cuentas en una sola línea de tiempo, marcando los empalmes |
| `/monitoreo` | Sitios, APIs, servicios y procesos con latencia, disponibilidad e incidentes |
| `/crm` | Embudo de Odoo por etapa, actividades programadas y oportunidades sin movimiento |
| `/equipo` | Carga de trabajo por persona y pendientes sin asignar |
| `/ajustes` | Cada conexión, su estado de sincronización y qué hace falta para conectarla de verdad |

## Cómo está armado

```
src/app/
  core/
    models/      Los tipos del portal: TaskItem, Meeting, MonitorTarget, CrmOpportunity...
    config/      Cuentas, conexiones y el token de configuración
    sources/     Un adaptador por integración
      demo/      Datos inventados, sin red ni credenciales
      gateway/   Adaptadores HTTP contra el backend puente
      local/     Pendientes capturados aquí, guardados en localStorage
    state/       PortalStore (señales) y selectores puros
    util/        Fechas y plurales
  features/      Una carpeta por vista, cargada por ruta
  ui/            Componentes compartidos: tarjetas, etiquetas, iconos, gráficas
```

La idea de fondo: **el portal no conoce a Odoo ni a Google**, conoce cuatro
interfaces (`TaskSource`, `CalendarSource`, `MonitorSource`, `CrmSource`).
Cada integración es una clase que las implementa. Cambiar una fuente de
demostración a real no cambia una sola línea de las vistas.

Una fuente que falla no tumba a las demás: se queda sin datos, su error queda
registrado y aparece en Ajustes.

## El backend puente

El navegador no puede hablar directo con Odoo, Google ni Microsoft: ninguno abre
CORS para una aplicación de página única, y meter esas credenciales en el
navegador las dejaría a la vista de cualquiera. En medio va un servicio propio
—el puente— que guarda las credenciales del lado del servidor y devuelve los
datos ya traducidos a los modelos del portal.

El puente se sirve en el mismo origen que el portal (`/api/portal` en
producción) para que la cookie de sesión viaje sola y no haya que abrir CORS.

Contrato que debe cumplir, colgando de la ruta de cada conexión:

```
GET {base}{path}/tasks                 -> TaskItem[]
GET {base}{path}/meetings?from=&to=    -> Meeting[]    (fechas en ISO)
GET {base}{path}/targets               -> MonitorTarget[]
GET {base}{path}/opportunities         -> CrmOpportunity[]
GET {base}{path}/activities            -> CrmActivity[]
```

Las formas exactas están en `src/app/core/models/`. El puente traduce; el portal
solo consume.

## Conectar una fuente de verdad

1. Implementar en el puente las rutas de esa conexión (ver arriba).
2. En `src/environments/environment.ts`, poner `gatewayUrl` con la raíz del
   puente.
3. En `src/app/core/config/portal-defaults.ts`, cambiar el `mode` de esa
   conexión de `demo` a `gateway`.

Eso es todo: `source.providers.ts` construye el adaptador que corresponda y la
vista ni se entera. Si `gatewayUrl` está vacío, la conexión se queda en
demostración en vez de fallar en cada petición — que es lo útil mientras el
puente no existe.

**Aquí no van credenciales.** Este repositorio es público. Usuarios, llaves y
tokens viven en el puente.

Lo que hace falta por fuente:

| Fuente | Qué se necesita del lado del puente |
| --- | --- |
| Odoo (Itech) | Usuario con lectura sobre `crm.lead` y `mail.activity`, URL de la instancia y nombre de la base. El puente se autentica por JSON-RPC |
| Google Calendar | Cliente OAuth con el permiso `calendar.readonly` y el consentimiento de la cuenta |
| Microsoft 365 | Registro de aplicación en Entra ID con `Calendars.Read` y el consentimiento de la cuenta |
| Ops | Credencial de lectura del tablero y el identificador del equipo de desarrollo |
| Monitoreo | La lista de destinos a vigilar. Las revisiones las hace el puente: desde el navegador no se puede por CORS, y además cada quien mediría su propia red |

Se pueden conectar de una en una: mientras Odoo ya sea real, los calendarios
pueden seguir en demostración sin que nada más cambie.

## Decisiones que conviene conocer

- **Angular 20 sin zone.js.** Todo el estado vive en señales, así que no hace
  falta el parche de zone.js; el arranque pesa menos.
- **Tailwind con variables CSS.** Los colores son variables (`--surface`,
  `--ink`), no clases fijas. El tema oscuro solo las repinta, y las plantillas
  usan nombres semánticos (`bg-surface`) en lugar de repetir `dark:` en cada
  clase.
- **Iconos propios.** Un catálogo de veintitantos `<symbol>` en lugar de una
  librería entera.
- **Los adaptadores de demostración tardan a propósito** (450 ms) para que las
  pantallas pasen por su estado de carga.
