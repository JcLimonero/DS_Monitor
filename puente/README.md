# DS Monitor · puente

El servicio que está en medio entre el portal y cada proveedor. Guarda las
credenciales del lado del servidor y devuelve los datos ya traducidos a los
modelos del portal.

Existe por dos razones concretas: ni Odoo, ni Google, ni Microsoft abren CORS
para una aplicación de página única, y meter esas credenciales en el navegador
las dejaría a la vista de cualquiera que abra las herramientas de desarrollo.

## Estado

Conectadas y probadas:

| Conexión | Qué alimenta | API |
| --- | --- | --- |
| Claude | Licencias | `usage_report/messages` y `cost_report` de la Admin API |
| Cursor | Licencias | `/teams/members`, `/teams/daily-usage-data`, `/teams/spend` |
| Figma | Licencias | `/v1/teams/{id}/members` — ver la salvedad abajo |
| Vercel | Despliegues y estado | `/v6/deployments` y la página pública de estado |
| Monitoreo | Plataformas | Revisión propia de cada URL |
| Odoo | CRM y pendientes | JSON-RPC contra `crm.lead` y `mail.activity` |
| GitHub | Repositorios | `/repos`, `/commits`, `/check-runs` y `/pulls` |
| Correo | Juntas, pendientes y licencias | IMAP (solo lectura) — ver abajo |

Todavía sin conectar: el tablero de Ops, y los buzones de Microsoft por API.
Sus rutas ya están registradas y responden con un mensaje claro, para que si
alguien cambia esa conexión a modo gateway antes de tiempo, Ajustes le diga qué
falta en vez de un 404 que parece un error de escritura.

## Los buzones de correo

Un buzón alimenta tres cosas, y ninguna viene de una API: se deducen de los
encabezados de los últimos meses.

- **Licencias**: recibos y avisos de renovación de suscripciones. Cada regla de
  `src/proveedores/correo.ts` reconoce a un proveedor (Microsoft 365, Zoom,
  AWS, Figma, Canva, Neubox, GoDaddy…); lo que suena a suscripción pero no es
  de un proveedor conocido cae en la regla genérica con el nombre del
  remitente. Una suscripción sigue vigente mientras su último recibo no tenga
  más de 75 días (mensuales) o dos años (anuales). El importe se lee del
  cuerpo del último recibo (la cantidad que sigue a "total", o la mayor);
  cuando el recibo no lo trae, el portal deja capturarlo a mano en Ajustes.
- **Pendientes**: correos de los últimos 30 días que piden hacer algo — un
  cobro rechazado, un dominio por vencer, un plan que vence hoy. Uno por asunto,
  con prioridad según la urgencia del aviso.
- **Juntas**: invitaciones con parte `text/calendar`. Solo lo que alguien mandó
  por correo; lo que uno crea directo en su calendario no pasa por aquí.

Lo que las reglas no reconocen lo lee la IA (`src/proveedores/ia.ts`) y decide
si es un pendiente. Antes de crear uno nuevo se revisa si el correo es la
respuesta o el seguimiento de un pendiente que ya está registrado
(`src/pendientes/relacionar.ts`): por asunto sin modelo (mismo asunto y, además,
que sea respuesta o reenvío —RE:/RV:/Fwd:— o venga del mismo remitente; los
hechos solo si se cerraron hace menos de 30 días), y por la lista de pendientes
abiertos que se le pasa al modelo. Si lo es, no se crea otro: el resumen del correo se pone como comentario ("Correo") en
el pendiente, queda en la trazabilidad y el pendiente sale con una **novedad**
(`unread`) que el portal enseña como chip hasta que alguien abre la tarjeta
(`POST /pendientes/visto`).

A los pendientes de correo abiertos, sin responsable y que nadie ha tocado (de
los últimos 30 días) se les busca responsable en cada lectura (`autoasignar` en
`rutas.ts`): si ya se aprendió a quién se le asigna lo de ese
remitente (`src/pendientes/aprendido.ts`, se aprende al asignar a mano y se
olvida al quitarlo), se asigna directo y se avisa por correo con la liga; si no,
la IA propone y solo se asigna sola con confianza alta. Con confianza media o
baja la propuesta queda como **sugerencia** (`suggestedAssignee`) en la tarjeta,
con "Asignar" y "×" para descartarla. A la IA se le pregunta una sola vez por
pendiente y como mucho cinco por lectura (el resto en la siguiente); con el
equipo vacío no se hace nada.

Lo que ya estaba registrado antes de que hubiera reglas (o más viejo que los
30 días) se atiende con el **barrido a demanda**: `POST /pendientes/autoasignar`
(con sesión o `PUENTE_ADMIN_TOKEN`; cuerpo opcional `{ maximoConsultas: 40,
reintentar: false, soloCuenta }`, tope 100 consultas) recorre los pendientes de
correo de todas las cuentas sin límite de días con la misma lógica
(`autoasignarPendientes` en `rutas.ts`, candidatos en
`src/pendientes/autoasignar.ts`) y devuelve el resumen: `revisados`,
`asignadosPorRegla`, `asignadosPorIa`, `sugeridos`, `sinPropuesta`, `omitidos`
(se acabaron las consultas o no hay IA) y `consultas`. Con `reintentar: true`
vuelve sobre los que ya se revisaron y siguen sin responsable ni sugerencia; en
ningún caso toca los asignados, hechos, eliminados ni los que alguien ya movió.
Lo asignado así queda en la trazabilidad como "por barrido". En el portal está
como botón **Autoasignar** en Pendientes (junto a "N sin responsable", solo con
puente y equipo capturado; confirma en línea y enseña el resumen) y en Telegram
como `/autoasignar`.

Además del responsable, un pendiente puede tener **seguidores** (`followers`):
se agregan desde el detalle de la tarjeta, reciben el mismo correo con liga, ven
el pendiente en `/mio/:token` marcado como "seguimiento" (pueden comentar y
cambiar el estado, no pedir que se reasigne) y en Equipo cuentan aparte
("+M seguimiento").

Cada buzón es una conexión del portal con ruta `/correo/<id>`, y se configuran
en `CORREO_CUENTAS` con la contraseña de cada uno en `CORREO_CONTRASENA_<ID>`
(ver `.env.example`). Hay dos caminos según el proveedor:

| Proveedor | Cómo entra el puente |
| --- | --- |
| Gmail (`google`) | IMAP a `imap.gmail.com` con una contraseña de aplicación |
| iCloud y Neubox (`imap`) | IMAP con contraseña de aplicación (iCloud) o del buzón (Neubox) |
| Microsoft (`microsoft`) | Microsoft ya no acepta IMAP con contraseña: se entra por **Microsoft Graph** con una aplicación registrada en Entra ID y el consentimiento de la persona. De ahí salen los correos y, mejor que las invitaciones sueltas, el **calendario completo** (`/me/calendarView`). Mientras una cuenta no esté conectada, la alimenta el barrido de Mail.app |

**Conectar un buzón desde Ajustes.** Con `PUENTE_ADMIN_TOKEN` en el entorno,
el portal puede guardar las credenciales de cada buzón (`POST
/correo/{id}/guardar`), probarlas (`POST /correo/{id}/probar`) y, para
Microsoft, pasar por el consentimiento (`POST /correo/{id}/oauth/inicio` →
login.microsoftonline.com → `GET /correo/oauth/callback`). Lo capturado se
guarda en `CORREO_DIRECTORIO` (por omisión `datos/correo/`, fuera del repo, un
archivo por buzón con permisos 600) y se pone encima de `CORREO_CUENTAS`.
`GET /correo/{id}/estado` dice qué tiene y qué le falta sin exponer secretos.

La aplicación de Entra ID necesita: tipo de cuentas con cuentas personales de
Microsoft incluidas (para Outlook.com), permisos delegados `Mail.Read`,
`Calendars.Read`, `User.Read` y `offline_access`, un client secret, y la URI de
redirección `<PUENTE_URL_PUBLICA>/correo/oauth/callback`.

**El barrido de Mail.app** (`npm run barrido`) corre en la Mac donde ya están
abiertos todos los buzones, les pide a Mail los encabezados por AppleScript,
corre las mismas reglas que el puente usa con IMAP, y manda licencias y
pendientes por ingesta. Necesita un emisor por buzón en `INGESTA_CLIENTES`, con
el mismo nombre que la cuenta y tipos `licencias,pendientes`, y su token en
`INGESTA_TOKEN_<ID>` al correrlo:

```bash
node dist/herramientas/barrido-mail.js --puente https://mi-puente/api/portal \
  --cuenta "JCLN Nexus|Bandeja de entrada|correo-nexus" \
  --cuenta "JCLN GMAIL|[Gmail]/Todos|correo-gmail"
```

Un buzón IMAP sin contraseña pero con emisor también se sirve de lo recibido,
así que el barrido puede alimentar los ocho buzones hasta que cada uno tenga su
contraseña en el puente. Un buzón grande (decenas de miles de mensajes) tarda
varios minutos; conviene programarlo cada hora con `launchd` o `cron`.

## Acceso, equipo y dominios

Con `ACCESO_CORREOS` y las cuatro variables de EmailJS (también capturables
desde Ajustes → Integraciones → Acceso al portal), el puente exige sesión en
todo menos `/salud`, `/acceso/*`, la ingesta (trae sus propios tokens) y el
regreso de OAuth. Entrar: `POST /acceso/codigo {correo}` manda un código de
seis dígitos por EmailJS (mismo servicio y plantilla, asunto "Access
Monitor"); `POST /acceso/entrar {correo, codigo}` devuelve un token de sesión
de 30 días que el portal manda como `Authorization: Bearer`. Una sesión
vigente también sirve para todo lo que antes pedía `PUENTE_ADMIN_TOKEN`.

El equipo (`GET /equipo`, `POST /equipo/guardar`) y los dominios
(`GET /dominios`, `POST /dominios/guardar`, y `GET /dominios/licenses` para el
tablero) viven en `DATOS_DIRECTORIO` como JSON, junto con las sesiones.

## Dos maneras de traer datos

**Ir por ellos**: el puente consulta la API del proveedor cada tanto. Es lo que
hacen los adaptadores de `src/proveedores/`, y es lo natural cuando el proveedor
tiene API y nosotros no controlamos el sistema.

**Recibirlos**: el sistema de origen empuja cuando algo cambia. Es lo natural
para lo nuestro — Ops, el CI, un script de vigilancia — y no requiere darle al
puente credenciales de esos sistemas.

La segunda va a ser la común, y tiene su propio documento con el cuerpo exacto
de cada envío: **[INGESTA.md](INGESTA.md)**.

Recibir trae tres problemas que ir por ellos no tiene, y los tres están
resueltos: los envíos llegan fuera de orden (se descartan los viejos por
`generadoEn`), un reinicio borraría lo recibido (se escribe a disco), y un
emisor que deja de mandar no se nota (cada uno tiene ventana de frescura y su
ruta responde 503 al vencerse).

## Arrancar

```bash
cd puente
npm install
cp .env.example .env    # y llenar lo que se vaya a conectar
npm run build
npm start               # http://localhost:8787
```

Para desarrollo, `npm run dev` reinicia solo al guardar.

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Compila a `dist/` |
| `npm test` | Compila y corre las pruebas |
| `npm run typecheck` | Revisa tipos sin generar nada |
| `npm run check:contrato` | Comprueba que el contrato siga igual al modelo del portal |
| `npm run format` | Aplica Prettier |

## Conectar una fuente

Hay dos maneras, y las dos terminan en las mismas variables de
`.env.example`:

- **Desde Ajustes del portal** (pestaña Integraciones o Correo): con
  `PUENTE_ADMIN_TOKEN` en el entorno, el portal lista qué variables tiene cada
  integración (`GET /integraciones`), las guarda (`POST
  /integraciones/{id}/guardar`) y prueba la conexión con la misma consulta que
  usa el tablero (`POST /integraciones/{id}/probar`). Lo guardado queda en
  `INTEGRACIONES_DIRECTORIO` (por omisión `datos/integraciones/`, fuera del
  repo) y se pone encima del entorno sin reiniciar. GitHub sin lista de
  repositorios vigila los diez con cambios más recientes.
- **En el entorno**, a mano:

1. Llenar sus variables en `.env` (ver `.env.example`).
2. Reiniciar el puente. En el arranque dice qué quedó configurado y qué falta:

   ```
   [puente] 1 de 6 conexiones configuradas: monitoreo
   [puente]   · anthropic apagada, falta ANTHROPIC_ADMIN_KEY
   ```

3. En el portal, poner `gatewayUrl` en `src/environments/environment.ts` (o
   escribir la raíz del puente en Ajustes, que la guarda en ese navegador) y
   cambiar el `mode` de esa conexión de `demo` a `gateway` en
   `src/app/core/config/portal-defaults.ts`.

**No hace falta conectar todo de golpe.** Una conexión sin credencial responde
503 con el nombre de la variable que falta, el portal lo muestra en Ajustes, y
las demás siguen funcionando.

`GET /salud` responde qué conexiones están encendidas, sin exponer ninguna
credencial. Sirve como health check del orquestador.

## El contrato con el portal

Las rutas son exactamente las que documenta
`portal/src/app/core/sources/gateway/gateway.sources.ts`:

```
GET /salud                             -> estado de las conexiones
GET /licencias/anthropic/licenses      -> LicenseUsage[]
GET /licencias/cursor/licenses         -> LicenseUsage[]
GET /licencias/figma/licenses          -> LicenseUsage[]
GET /vercel/deployments                -> Deployment[]
GET /vercel/platform-status            -> PlatformStatus[]
GET /vercel/licenses                   -> LicenseUsage[]
GET /monitoreo/estado/targets          -> MonitorTarget[]
GET /odoo/itech/opportunities          -> CrmOpportunity[]
GET /odoo/itech/activities             -> CrmActivity[]
GET /odoo/itech/tasks                  -> TaskItem[]
GET /github/repos                      -> RepoStatus[]
GET /correo/{id}/licenses              -> LicenseUsage[]  (deducidas del buzón)
GET /correo/{id}/tasks                 -> TaskItem[]      (correos que piden una acción)
GET /correo/{id}/meetings?from=&to=    -> Meeting[]       (invitaciones .ics o calendario de Graph)
GET  /integraciones                    -> variables de cada integración, sin secretos
POST /integraciones/{id}/guardar       <- variables                  (PUENTE_ADMIN_TOKEN)
POST /integraciones/{id}/probar        -> { ok, mensaje }            (PUENTE_ADMIN_TOKEN)
GET  /correo/{id}/estado               -> qué tiene y qué le falta al buzón
POST /correo/{id}/guardar              <- credenciales del buzón   (PUENTE_ADMIN_TOKEN)
POST /correo/{id}/probar               -> { ok, mensaje }          (PUENTE_ADMIN_TOKEN)
POST /correo/{id}/oauth/inicio         -> { url } de Microsoft     (PUENTE_ADMIN_TOKEN)
GET  /correo/oauth/callback            -> regreso de Microsoft, redirige al portal

POST /ingesta/{tipo}                   <- recibir datos (ver INGESTA.md)
GET  /recibido/{emisor}/{recurso}      -> lo recibido, ya traducido
GET  /ingesta/estado                   -> emisores, rutas y frescura
```

Lo de `/odoo/itech/tasks` merece una nota: el portal le pide a la conexión de
Odoo tanto `crm` como `tasks`, porque una actividad programada en el CRM es un
pendiente igual que cualquier otro y quien la tiene asignada la quiere ver junto
con las del tablero de Ops. Ese hueco no se notó leyendo el código — lo encontró
la prueba de costura.

Los tipos viven copiados en `src/nucleo/contrato.ts`, porque un servicio de
backend no debe compilar contra el código de una aplicación Angular. Para que
la copia no se desincronice en silencio, `contrato/sincronia.ts` comprueba en
tiempo de compilación que ambos lados sigan siendo asignables entre sí:
`npm run check:contrato` deja de compilar si alguien cambia un campo de un solo
lado. Está probado que falla cuando debe.

## Decisiones que conviene conocer

**Cero dependencias en tiempo de ejecución.** Node 22 ya trae `fetch` y un
servidor HTTP; el router completo son sesenta líneas. Para diez rutas GET que
devuelven JSON, un marco traería decenas de paquetes transitivos a un servicio
que guarda todas las credenciales de la empresa. Las únicas dependencias son de
desarrollo: TypeScript, los tipos de Node y Prettier.

**Caché con vencimiento, y en memoria.** No es una optimización: es lo que evita
pasarse de los límites. Cursor corta en veinte peticiones por minuto por equipo,
y los datos de uso de Claude tardan hasta cinco minutos en aparecer, así que
refrescar más seguido no trae nada nuevo. El caché además une las peticiones
simultáneas: tres pestañas del portal abiertas a la vez pegan una sola vez al
proveedor. Es en memoria a propósito — si el proceso se reinicia, lo peor que
pasa es una consulta de más; un caché persistente serviría datos viejos sin que
nadie lo note.

**Un fallo no se guarda en caché.** Si el proveedor falla, el siguiente intento
vuelve a preguntar en lugar de servir el error durante cinco minutos.

**Lo que el proveedor no publica se marca, no se inventa.** Figma no tiene API
de facturación: el tope de asientos, el costo y la renovación se capturan en el
entorno y la licencia sale con `manual: true`, que el portal muestra como
**Capturado a mano**. Lo mismo con los asientos de Claude Code y el gasto de
Vercel. Es preferible una etiqueta honesta a un número que parece vivo y no lo
está.

**Un estado desconocido nunca pasa por exitoso.** Si Vercel devuelve un estado
de despliegue que el traductor no conoce, se reporta como "en cola", no como
"listo". Pintar de verde algo que no sabemos que terminó es el peor error que
puede cometer un tablero.

## Pruebas

`npm test` corre 67 pruebas sobre lo que de verdad se puede romper en silencio:
los traductores de cada proveedor (sumas de tokens, centavos a dólares, estados
de despliegue, fechas de Odoo, prioridades), la normalización de todo lo que se
recibe, el almacén (orden, persistencia, frescura) y el router. No tocan la red.

**La prueba de costura** es la que más gana el sueldo: lee la configuración real
del portal, arma las URLs que va a pedir y comprueba que el puente publique cada
una. Falla si alguien agrega una capacidad de un lado y olvida el otro. Así
apareció `/odoo/itech/tasks`, que estaba declarado en el portal y no existía
aquí; sin esa prueba se habría descubierto el día de conectar, en producción.

**La comprobación del contrato** (`npm run check:contrato`) está probada a mano:
al cambiar a propósito el tipo de un campo, deja de compilar. Un guardián que
nunca falla no sirve de guardián.

El monitoreo además se probó de extremo a extremo contra un servicio local que
responde bien, mal y lento, y los tres casos se reportaron como operativo, caído
y degradado.
