# Portal Dealer Solutions

Una sola pantalla para lo que hoy está repartido en muchos lugares: los
pendientes propios, los del tablero de Ops y los del CRM, las juntas de las
distintas cuentas de correo, el estado de los sitios y servicios desplegados, el
embudo de Odoo de Itech, los despliegues de Vercel y el consumo de las
suscripciones (Claude, Cursor, Figma, Vercel).

Se usa de dos maneras:

- **Como portal**, en la computadora, con barra lateral y filtros.
- **Como carrusel**, en el monitor fijo de la oficina: a pantalla completa,
  cambiando solo de categoría, sin que nadie lo opere.

Es una aplicación aparte de `VGD_SF_Track`: vive en esta carpeta, se construye y
se despliega por su cuenta, y no toca nada de lo que ya está en producción.

## Estado actual

Las siete vistas de escritorio y el carrusel están completos y navegables.
**Todas las fuentes siguen en modo demostración**: los datos son inventados, y
los nombres de personas, clientes y dominios también, porque este repositorio es
público.

El backend puente ya existe (carpeta `puente/`) con seis conexiones listas:
Claude, Cursor, Figma, Vercel, monitoreo y Odoo. Falta desplegarlo, darle las
credenciales y cambiar el `mode` de esas conexiones de `demo` a `gateway` — lo
que no hace falta es tocar una sola vista. Ver *Conectar una fuente de verdad*.

Lo que todavía no hay: los calendarios de Google y Microsoft y el tablero de Ops
del lado del puente, y pruebas automatizadas de los selectores del portal
(`portal.selectors.ts`), que es donde vive la lógica que más se puede romper en
silencio. Los traductores del puente sí están probados.

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
| `/despliegues` | Despliegues de Vercel con rama, commit y estado, más el estado de la plataforma |
| `/licencias` | Consumo de las suscripciones: asientos, tokens, gasto y renovaciones |
| `/ajustes` | Cada conexión, su estado de sincronización y qué hace falta para conectarla de verdad |
| `/carrusel` | Modo monitor: ocho pantallas que se turnan solas |

## El monitor de la oficina

`/carrusel` corre sin barra lateral y va rotando ocho pantallas:

1. **Resumen del día** — las cifras, lo que sigue en la agenda y lo que requiere
   atención (incluidos despliegues fallidos y licencias por vencer)
2. **Pendientes críticos** — lo vencido y lo de hoy, de cualquier fuente
3. **Agenda** — hoy y mañana lado a lado, marcando los empalmes
4. **Plataformas** — todos los destinos vigilados, lo roto primero
5. **Despliegues** — los últimos de Vercel y el estado de la plataforma
6. **Embudo comercial** — etapas de Odoo y las siguientes actividades
7. **Licencias y consumo** — cuánto se lleva usado de cada suscripción
8. **Equipo** — carga por persona

Detalles pensados para una pantalla que nadie atiende:

- **Ritmo ajustable por la URL**: `/carrusel?segundos=30` (entre 5 y 300, por
  omisión 20).
- **Vuelve a pedir los datos al completar cada vuelta**, para que un monitor que
  lleva horas prendido no siga mostrando la foto de la mañana.
- **Mantiene la pantalla despierta** con la API de Wake Lock, para que el
  protector de pantalla no tape el tablero.
- **Los controles se esconden solos** a los tres segundos sin movimiento. Con
  teclado: barra espaciadora pausa, flechas cambian de pantalla, `F` alterna
  pantalla completa.
- **Si una fuente se cae**, sale un aviso en el encabezado y en la columna de
  atención, en vez de mostrar cifras viejas como si nada.

### Dejarlo corriendo

El navegador no permite entrar a pantalla completa sin que alguien lo pida, así
que para una pantalla desatendida conviene arrancar el navegador ya en modo
kiosco:

```bash
chromium --kiosk --incognito "https://portal.example.mx/carrusel?segundos=25"
```

Si el equipo es Windows, el mismo parámetro funciona con `chrome.exe`. Conviene
además desactivar la suspensión del monitor en el sistema operativo: el Wake
Lock ayuda, pero no manda sobre la configuración de energía del equipo.

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
  layout/        El armazón con barra lateral
  features/      Una carpeta por vista, cargada por ruta
    carrusel/    El modo monitor y sus seis diapositivas
  ui/            Componentes compartidos: tarjetas, etiquetas, iconos, gráficas
```

Las dos maneras de usar el portal son dos ramas del ruteo: `ShellComponent`
envuelve las vistas de escritorio, y el carrusel cuelga directo de la raíz
porque no lleva nada alrededor. Ambas leen del mismo `PortalStore`, así que el
monitor y la computadora siempre muestran lo mismo.

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

**Vive en `puente/` de este mismo repositorio.** Ver `puente/README.md` para
levantarlo y `puente/.env.example` para la lista completa de credenciales.

El puente se sirve en el mismo origen que el portal (`/api/portal` en
producción) para que la cookie de sesión viaje sola y no haya que abrir CORS.

Contrato que debe cumplir, colgando de la ruta de cada conexión:

```
GET {base}{path}/tasks                 -> TaskItem[]
GET {base}{path}/meetings?from=&to=    -> Meeting[]    (fechas en ISO)
GET {base}{path}/targets               -> MonitorTarget[]
GET {base}{path}/opportunities         -> CrmOpportunity[]
GET {base}{path}/activities            -> CrmActivity[]
GET {base}{path}/licenses              -> LicenseUsage[]
GET {base}{path}/deployments           -> Deployment[]
GET {base}{path}/platform-status       -> PlatformStatus[]
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
| Claude | Una **Admin API key** de la organización (`sk-ant-admin...`) |
| Cursor | Una **Team API key** con permiso `admin:*` o `usage:*` |
| Figma | Un token con acceso a la organización — con una salvedad grande, ver abajo |
| Vercel | Un **access token** con acceso al equipo |

### Qué expone de verdad cada proveedor de licencias

Esto se verificó contra la documentación de cada uno antes de escribir los
adaptadores, porque de aquí depende qué se puede mostrar y qué no:

| Proveedor | Endpoint | Qué devuelve |
| --- | --- | --- |
| Claude | `GET /v1/organizations/usage_report/messages` | Tokens por periodo, en cubetas de `1m`, `1h` o `1d`, agrupables por modelo, espacio de trabajo, llave o nivel de servicio |
| Claude | `GET /v1/organizations/cost_report` | Gasto en USD, solo granularidad diaria, agrupable por espacio de trabajo o concepto |
| Cursor | `POST https://api.cursor.com/teams/daily-usage-data` | Uso diario por persona (autenticación Basic con la llave) |
| Cursor | `/teams/spend`, `/teams/members` | Gasto y miembros del equipo |
| Vercel | `GET https://api.vercel.com/v6/deployments` | Despliegues con estado, rama, commit y entorno (`Authorization: Bearer`) |
| Vercel | Página pública de estado | Incidentes de la plataforma misma |

Tres cosas que conviene tener presentes:

- **Los reportes de uso y costo de Claude no están en los SDK.** Van por HTTP
  crudo, con los encabezados `x-api-key` y `anthropic-version: 2023-06-01`. Los
  datos tardan hasta cinco minutos en aparecer y no conviene sondear más de una
  vez por minuto; el puente debe guardar el resultado en caché.
- **Cursor limita a veinte peticiones por minuto por equipo.** Una sola consulta
  por ciclo de refresco basta y sobra.
- **Figma no publica facturación ni asientos contratados por API.** Se puede
  contar quién ocupa asiento con `/v1/teams/{id}/members` y, en Enterprise,
  quién estuvo activo con `/v1/activity_logs` (permiso `org:activity_log_read`),
  pero el tope contratado, el costo y la fecha de renovación hay que capturarlos
  a mano. Por eso el modelo trae la bandera `manual`, y la interfaz marca esas
  licencias con **Capturado a mano** en vez de hacerlas pasar por dato vivo.

Se pueden conectar de una en una: mientras Odoo ya sea real, los calendarios
pueden seguir en demostración sin que nada más cambie.

## Identidad visual

Los colores y la tipografía son los de la papelería de Dealer Solutions: navy
`#0A2540`, cyan `#06B6D4` para las reglas y acentos, el azul del logo `#4292D1`
como color informativo, y Arial en todo.

En `public/` hay tres imágenes derivadas del logo de la marca: la versión para
fondo claro, una variante aclarada para el tema oscuro (el logo original viene
sobre blanco y sus grises desaparecen sobre navy) y el toro recortado como
favicon.

## Decisiones que conviene conocer

- **Angular 20 sin zone.js.** Todo el estado vive en señales, así que no hace
  falta el parche de zone.js; el arranque pesa menos.
- **Tailwind con variables CSS.** Los colores son variables (`--surface`,
  `--ink`), no clases fijas. El tema oscuro solo las repinta, y las plantillas
  usan nombres semánticos (`bg-surface`) en lugar de repetir `dark:` en cada
  clase. El carrusel usa la misma paleta: se puede dejar en claro o en oscuro
  según la luz de la oficina.
- **Iconos propios.** Un catálogo de veintitantos `<symbol>` en lugar de una
  librería entera.
- **Los adaptadores de demostración tardan a propósito** (450 ms) para que las
  pantallas pasen por su estado de carga.
