# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

DS Monitor: un tablero para una sola persona (el director) y la gente de su equipo. Junta pendientes, juntas, correo, servidores, despliegues, licencias, dominios y CRM de varias empresas. Se usa en tres lugares: el **portal** en la computadora, el **carrusel** (`/carrusel`) y una página sin sesión para el equipo (`/mio/:token`). El dispositivo principal del carrusel es un **iPad** (táctil, sin ratón); la TV es secundaria.

Dos paquetes independientes, cada uno con su `package.json`, `node_modules` y job en `.github/workflows/ci.yml`:

- `portal/`: Angular 20 **sin zone.js** (signals), Tailwind 3. Estático.
- `puente/`: backend en Node 22 + TypeScript (ESM). Guarda credenciales, consulta o recibe datos y los traduce al modelo del portal. Única dependencia de ejecución: `pg`; el router y el servidor HTTP son propios (sin framework).

Los README de cada paquete y `puente/INGESTA.md` (cuerpo exacto de cada envío a `/ingesta/*`) son la referencia detallada. La sección "Estado" del README raíz está desactualizada (dice que todo corre en demostración; hoy hay datos reales).

## Comandos

```bash
# puente (cd puente)
npm run build                 # tsc -> dist/
npm start                     # node dist/index.js, puerto 8787
npm run dev                   # node --watch --experimental-strip-types src/index.ts
npm test                      # build + node --test "dist/**/*.prueba.js"
npm run typecheck
npm run check:contrato        # el contrato del puente y el del portal siguen iguales
npm run format:check          # npm run format aplica Prettier

# una sola prueba del puente (las pruebas corren sobre dist/, hay que compilar antes)
npm run build && node --test dist/ruta/archivo.prueba.js
npm run build && node --test --test-name-pattern="texto del caso" dist/ruta/archivo.prueba.js

# portal (cd portal)
npm start                     # ng serve
npm run build                 # producción; también revisa los tipos de las plantillas
npm run typecheck && npm run format:check
npm test                      # tsx --test sobre una LISTA FIJA de archivos en package.json
npx tsx --test src/app/core/ruta/archivo.prueba.ts   # una sola prueba
```

- Las pruebas se llaman `*.prueba.ts` (no `.spec`). En el portal **un archivo de pruebas nuevo no corre hasta agregarlo a la lista del script `test`** de `portal/package.json`.
- El CI exige: portal `format:check` + `typecheck` + `build`; puente `format:check` + `typecheck` + `check:contrato` + `test`. Prettier: comillas simples, sin comas finales, `bracketSameLine`; en `.html`/`.scss` comillas dobles.
- Para probar contra un puente propio sin tocar datos reales, arráncalo con `PUENTE_PUERTO`, `DATOS_DIRECTORIO`, `CORREO_DIRECTORIO`, `INGESTA_DIRECTORIO` y `PUENTE_ADMIN_TOKEN=prueba`, y apunta el portal con `localStorage['ds-monitor.puente']` y `['ds-monitor.puente-token']`. Mata los procesos por PID, no con `pkill -f "node dist/index.js"` (hay otros puentes en la misma máquina).

## Arquitectura

**El contrato está copiado a propósito.** Los tipos del modelo viven en `puente/src/nucleo/contrato.ts` y en `portal/src/app/core/models/`; `puente/contrato/sincronia.ts` (y `contrato/ajustes.ts`) comprueba en compilación que ambos lados sean asignables entre sí. Si cambias un campo de un lado, `npm run check:contrato` falla hasta que cambies el otro y lo agregues a la lista de `sincronia.ts`.

**Puente (`puente/src/`)**
- `servidor/rutas.ts` (~6 000 líneas) arma todas las rutas con el router propio (`servidor/router.ts`). Ahí viven `exigirAdmin`, el conjunto `LIBRES` de rutas sin sesión (`salud`, `acceso`, `ingesta`, `recibido`, `telegram`, `mio`) y las tareas periódicas (`programables.push({ nombre, cadaMinutos, correr })`). Las lecturas `GET` de datos de configuración siguen la política de `/equipo` y `/empresas`: piden sesión cuando el acceso por código está activo.
- Persistencia: la interfaz `Persistencia` (`datos/persistencia.ts`) tiene dos implementaciones, archivos en `datos/` y Postgres (`DATABASE_URL`; en la primera arrancada con la base vacía copia lo que haya en archivos). Los datos se guardan con `AlmacenJson` (documento en memoria + persistido) o `AlmacenTabla` (tabla propia con diff por huella y espejo en el documento); sus definiciones están en `datos/tablas.ts` y se cargan en `abrirDatos`/`cargarDatos` de `rutas.ts`. Para un dato nuevo compartido, sigue el patrón de `datos/empresas.ts`/`servidores.ts`: validación pura + almacén + rutas `GET` y `POST …/guardar`.
- Dos maneras de traer datos: **ir por ellos** (`proveedores/*`: Anthropic, Cursor, Figma, Vercel, GitHub, Odoo, Coolify, Prometheus, Cloudflare, correo por IMAP/Graph) y **recibirlos** (`ingesta/*`: el sistema de origen empuja con un token; los envíos viejos se descartan por `generadoEn`; cada emisor tiene ventana de frescura y su ruta responde 503 al vencerse).
- Las conexiones se declaran en `integraciones/catalogo.ts` (campos, secretos, "probar") y se leen de `config/entorno.ts` (variables de entorno o capturadas desde el portal). Un fallo del proveedor **no se guarda en caché**; lo que el proveedor no publica se marca (`manual: true`), no se inventa.
- Cotizaciones (`/ingesta/crm` de una app propia): `datos/crm-seguimiento.ts` (documento `crm-seguimiento`: cuándo cambió cada etapa, actividades vistas, movimientos manuales sin confirmar; llaves `emisor|id` para que un emisor nunca toque lo de otro), `pendientes/cotizaciones.ts` (límites por etapa y decisión de crear/cerrar el pendiente `cotizacion-<id>`) y `servidor/rutas-cotizaciones.ts` (mover etapa, ajustes, tarea horaria y la conexión `/ops/cotizaciones/*` que lee el portal). Mientras un movimiento manual no se confirme (`GET /ingesta/cambios` + `POST /ingesta/cambios/confirmar`, con token de emisor) el puente sirve la etapa manual aunque el emisor mande otra. Detalle y trampas de nombres de etapa en `puente/INGESTA.md`.
- IA (`ia/`, `proveedores/ia.ts`): los prompts arman el contexto de empresas y proveedores desde sus catálogos editables (`contextoEmpresas()`, `opcionesEmpresa()`), no desde listas fijas.
- Buzones de Microsoft: todos usan la aplicación general de Entra ID (`config.microsoftApp`) salvo que el buzón guarde la suya (client ID + secret + tenant, `correo/app-propia.ts`; reglas en `puente/README.md`). Cualquier código OAuth/Graph debe usar `cuenta.microsoft` de `almacenCorreo.efectiva(...)`, nunca `config.microsoftApp` directo, y todo texto que salga de una llamada a Entra pasa por `ocultarSecretos`.
- Correo: los pendientes se deducen de los buzones (reglas + IA) y se registran por cuenta; hay exclusiones explícitas (avisos de Total One, rebotes del servidor, avisos automáticos del DMS, juntas que un emisor manda como pendiente). Asignar a un correo del dueño no manda correo; el mismo aviso a la misma persona no se repite en 24 h.

**Portal (`portal/src/app/`)**
- `core/sources/`: el portal no conoce a ningún proveedor; habla con siete interfaces (`TaskSource`, `CalendarSource`, `MonitorSource`, `CrmSource`, `LicenseSource`, `DeploymentSource`, `RepoSource`) y cada conexión corre en demostración o contra el puente (`core/config/portal-defaults.ts`). `core/state/portal.store.ts` + `portal.selectors.ts` juntan todo.
- Arranque: `core/config/configuradas.ts` (`provideCuentasConfiguradas`) pregunta a `GET /salud` y a `GET /ajustes-portal` antes de construir los adaptadores y enciende o apaga cuentas. Agregar o apagar una cuenta pide recargar.
- **Qué va en `localStorage` y qué no**: solo preferencias del dispositivo (tema, token de sesión, URL del puente, posición del carrusel, "Con hechos"). Todo lo demás (licencias a mano y sus renovaciones, apagar fuentes, modo, buzones agregados) vive en el puente para que la TV y los demás equipos vean lo mismo. Las migraciones desde `localStorage` se hacen solo con un clic del usuario.
- Carrusel (`features/carrusel/`): cada diapositiva implementa `DiapositivaConContenido` (`vacia`, opcional `enDialogo` para pausar). Estilos `.tv-card`, `.tv-label`, `.tv-row`, `.tv-rejilla` en `styles.scss`; mientras está activo `<html>` lleva la clase `kiosco` y su raíz es fluida (`clamp`) desde 640 px; con un diálogo en hoja completa se añade `con-dialogo` (raíz a 16 px). Las rejillas son `auto-fill`, no dependen de `lg:`. Los controles flotantes ocupan el rincón inferior derecho (~324 px): lo que se coloque ahí abajo debe dejarlo libre. Todo lo táctil mide ≥ 44 px.
- `ui/dialogo.component.ts` es un diálogo compartido que atrapa el foco y lo devuelve; úsalo en vez de crear overlays nuevos (el carrusel tiene su propio overlay para los diálogos de pendiente y licencia).

## Despliegue

`main` despliega solo: el **puente** en Render (`render.yaml`, base Postgres `ds-monitor-db`) y el **portal** en Vercel (`portal/vercel.json`, reenvía `/api/portal/*` al puente, así no hay CORS). Cuando el portal depende de una ruta nueva del puente, el puente debe quedar en vivo primero.

## Convenciones

- Código, nombres, comentarios y textos de interfaz en **español de México**; los comentarios van sin acentos. Los textos de usuario sí llevan acentos.
- Nunca se hace push a `main`: rama corta → PR → CI en verde → squash merge cuando el usuario lo pide. Los commits terminan con la línea `Co-Authored-By` que indique el entorno.
- Diseño: la paleta vive en `portal/src/styles.scss` (tokens `--*`; claro azul/gris de Dealer Solutions, oscuro grafito/cobre, sin azules). No se inventan colores. Nombres fijos de secciones: Hoy, Pendientes, Míos, Servidores, Despliegues, Ejecuciones, Integraciones. El agente `.claude/agents/ui-ux.md` revisa diseño y por omisión solo propone.
- Los secretos y tokens nunca van en el repo ni en el chat: se capturan en el portal (Integraciones) o en el entorno del puente. `puente/datos/` está en `.gitignore` porque puede traer datos reales.
