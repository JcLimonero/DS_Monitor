# Puente del portal

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

Todavía sin conectar: los calendarios de Google y Microsoft, y el tablero de
Ops. Sus rutas ya están registradas y responden 501 con un mensaje claro, para
que si alguien cambia esa conexión a modo gateway antes de tiempo, Ajustes le
diga que falta construirla en vez de un 404 que parece un error de escritura.

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

1. Llenar sus variables en `.env` (ver `.env.example`).
2. Reiniciar el puente. En el arranque dice qué quedó configurado y qué falta:

   ```
   [puente] 1 de 6 conexiones configuradas: monitoreo
   [puente]   · anthropic apagada, falta ANTHROPIC_ADMIN_KEY
   ```

3. En el portal, poner `gatewayUrl` en `src/environments/environment.ts` y
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
