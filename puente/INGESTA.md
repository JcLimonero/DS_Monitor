# DS Monitor · cómo mandarle datos al puente

Hay dos maneras de traer datos: **ir por ellos** (el puente consulta la API del
proveedor) o **recibirlos** (el sistema de origen empuja cuando algo cambia).
Este documento es la segunda, que va a ser la común.

Recibir tiene tres problemas que ir por ellos no tiene, y los tres están
resueltos aquí: los envíos llegan **fuera de orden**, un **reinicio** borraría
lo recibido, y un emisor que **deja de mandar** no se nota. Lee *Reglas que
conviene conocer* antes de integrar.

## Lo básico

```
POST {base}/ingesta/{tipo}
Authorization: Bearer <token del emisor>
Content-Type: application/json
```

Tipos: `pendientes`, `juntas`, `monitoreo`, `crm`, `licencias`, `despliegues`,
`repos`, `equipo`.

**El emisor se identifica por el token, nunca por el cuerpo.** Así nadie puede
escribir en el buzón de otro cambiando un campo del JSON. Cada token trae de
fábrica qué tipos puede mandar y con qué cuenta del portal se marcan sus datos;
eso se configura en `INGESTA_CLIENTES` (ver `.env.example`) o, más cómodo, se
crea desde la aplicación: en Pendientes y en Equipo hay un panel "API para
alimentar…" que crea el emisor y enseña su token una sola vez.

Todos los envíos van dentro del mismo sobre:

```json
{
  "version": 1,
  "modo": "reemplazar",
  "generadoEn": "2026-09-14T10:00:00Z",
  "datos": []
}
```

| Campo | Obligatorio | Qué hace |
| --- | --- | --- |
| `version` | sí | Hoy siempre `1`. Un número distinto se rechaza en vez de adivinar. |
| `modo` | no | `reemplazar` (por omisión) o `agregar`. Ver abajo. |
| `generadoEn` | no | Cuándo se **midió** el dato, no cuándo se manda. Por omisión, ahora. |
| `datos` | sí | El contenido, según el tipo. |

### `reemplazar` contra `agregar`

- **`reemplazar`**: esto es el estado completo de ese emisor. Lo que no venga se
  considera que ya no existe. Es lo correcto para un envío periódico que manda
  toda su lista.
- **`agregar`**: mezcla por identificador sobre lo que ya había. Es lo correcto
  para un evento suelto.

La diferencia importa: **un webhook de un solo despliegue en modo `reemplazar`
borraría los otros cinco.** Si mandas eventos sueltos, usa `agregar`.

### Respuesta

```json
{ "recibido": true, "elementos": 12 }
```

Si `recibido` es `false` viene además un `motivo`. El caso normal es un envío
que llegó fuera de orden.

---

## Los cuerpos, uno por uno

### Pendientes — `POST /ingesta/pendientes`

Solo `id` y `titulo` son obligatorios.

```json
{
  "version": 1,
  "generadoEn": "2026-09-14T10:00:00Z",
  "datos": [
    {
      "id": "OPS-482",
      "titulo": "Reintentos del envío a Salesforce",
      "descripcion": "La cola se queda con los registros que fallan por token vencido.",
      "estado": "bloqueado",
      "prioridad": "urgente",
      "venceEn": "2026-09-12T13:00:00Z",
      "responsable": { "nombre": "Bruno Casares", "correo": "bruno@example.com" },
      "proyecto": "Integración SF",
      "url": "https://ops.example.mx/tarea/482",
      "etiquetas": ["backend", "integracion"],
      "actualizadoEn": "2026-09-14T09:40:00Z"
    }
  ]
}
```

`estado`: `pendiente` · `en_progreso` · `bloqueado` · `hecho` (por omisión `pendiente`)
`prioridad`: `baja` · `media` · `alta` · `urgente` (por omisión `media`)
`origen`: `ops` (por omisión) · `correo`, cuando el pendiente se dedujo de un
buzón; el portal lo agrupa con los demás del correo.

### Equipo — `POST /ingesta/equipo`

Las personas del equipo. Se mezclan con las capturadas en la aplicación (sin
repetir, por correo o identificador) y salen en la vista Equipo.

```json
{
  "version": 1,
  "datos": [
    { "nombre": "Ana Robles", "correo": "ana@example.com", "rol": "Frontend" },
    { "id": "u-42", "nombre": "Bruno Casares", "rol": "Backend" }
  ]
}
```

### Juntas — `POST /ingesta/juntas`

`id`, `titulo` e `inicio` son obligatorios. Sin `fin` se asume una hora.

```json
{
  "version": 1,
  "datos": [
    {
      "id": "evt_9931",
      "titulo": "Revisión de la integración con Salesforce",
      "inicio": "2026-09-14T17:00:00Z",
      "fin": "2026-09-14T18:00:00Z",
      "todoElDia": false,
      "estado": "confirmada",
      "organizador": { "nombre": "Bruno Casares", "correo": "bruno@example.com" },
      "asistentes": [{ "nombre": "Juan Carlos" }, { "nombre": "Elena Paredes" }],
      "lugar": "Sala 2",
      "enlace": "https://meet.example.com/integracion-sf",
      "notas": "Traer el conteo de registros en cola."
    }
  ]
}
```

`estado`: `confirmada` · `tentativa` · `cancelada` (por omisión `confirmada`)

### Monitoreo — `POST /ingesta/monitoreo`

Mandas **el resultado de cada revisión**; el puente arma el historial y calcula
la disponibilidad. Así el emisor puede ser un script de tres líneas en lugar de
tener que llevar estadísticas.

Este tipo **siempre acumula**, aunque mandes `modo: "reemplazar"`: cada envío es
una revisión más, no el estado completo. Reemplazar borraría el historial.

```json
{
  "version": 1,
  "datos": [
    {
      "id": "api-ejemplo",
      "nombre": "API Ejemplo",
      "url": "https://api.example.mx/health",
      "tipo": "api",
      "entorno": "produccion",
      "ok": true,
      "latenciaMs": 1320,
      "codigo": 200,
      "revisadoEn": "2026-09-14T10:00:00Z",
      "incidente": "La latencia lleva 40 minutos arriba de un segundo.",
      "enMantenimiento": false
    }
  ]
}
```

`ok` es obligatorio. El estado sale solo: `ok: false` es **caído**, `ok: true`
con más de 1000 ms es **degradado**, `enMantenimiento: true` es
**mantenimiento** aunque no responda.

`tipo`: `sitio` · `api` · `servicio` · `proceso` (por omisión `sitio`)
`entorno`: `produccion` · `pruebas` · `desarrollo` (por omisión `produccion`)

### CRM — `POST /ingesta/crm`

Aquí `datos` es un objeto, no una lista.

```json
{
  "version": 1,
  "datos": {
    "oportunidades": [
      {
        "id": "opp-1204",
        "nombre": "Licenciamiento y soporte anual",
        "cliente": "Grupo Delta",
        "etapa": "Propuesta enviada",
        "importe": 480000,
        "moneda": "MXN",
        "probabilidad": 60,
        "cierreEsperado": "2026-09-26T12:00:00Z",
        "vendedor": { "nombre": "Juan Carlos" },
        "url": "https://crm.example.com/odoo/crm/1204",
        "actualizadoEn": "2026-09-14T09:00:00Z"
      }
    ],
    "actividades": [
      {
        "id": "act-88",
        "resumen": "Mandar el desglose de licencias",
        "tipo": "Correo",
        "venceEn": "2026-09-14T21:00:00Z",
        "responsable": { "nombre": "Juan Carlos" },
        "oportunidadId": "opp-1204",
        "oportunidadNombre": "Licenciamiento y soporte anual",
        "url": "https://crm.example.com/odoo/actividad/88"
      }
    ]
  }
}
```

`etapa` y `tipo` aceptan **el nombre que use tu sistema**: el puente los
clasifica por palabras. Una etapa que no reconoce cae en `nuevo`, que es la
lectura conservadora del embudo.

### Cotizaciones — `POST /ingesta/crm`

Una app que genera cotizaciones las manda como oportunidades del CRM. Es el
mismo envío de arriba, con una convención de estados, y el puente le agrega
tres cosas: seguimiento del estatus, mover la etapa desde el tablero y un
pendiente cuando una cotización abierta se queda quieta. El emisor necesita el
tipo `crm`.

**Estados.** El puente clasifica el texto de `etapa` por palabras. Con estos
seis nombres cae donde debe:

| `etapa` que manda la app | Etapa del tablero |
| --- | --- |
| `Generada` | Nuevo |
| `Calificada` | Calificado |
| `Cotización enviada` | Propuesta |
| `En negociación` | Negociación |
| `Ganada` | Ganado |
| `Perdida` | Perdido |

**Trampa con los nombres:** lo que no lleva "gana", "perdi", "negocia",
"propuesta", "cotiza" ni "calific" cae en **Nuevo**, que es la lectura
conservadora. `Aceptada`, `Rechazada`, `Cerrada` o `Cancelada` NO se entienden
como cierre: la cotización se vería como nueva y el pendiente de vencimiento
la seguiría vigilando. Usa `Ganada` y `Perdida`. Ojo también con nombres que
mezclan palabras (`Cotización perdida` es Perdido; `Cotización enviada` es
Propuesta, no Perdido por llevar "cotiza").

```json
{
  "version": 1,
  "modo": "reemplazar",
  "generadoEn": "2026-10-06T15:00:00Z",
  "datos": {
    "oportunidades": [
      {
        "id": "COT-2031",
        "nombre": "Licencias anuales",
        "cliente": "Grupo Delta",
        "etapa": "Cotización enviada",
        "importe": 48000,
        "vendedor": { "nombre": "Juan Carlos", "correo": "jc@example.com" },
        "url": "https://cotizaciones.example.com/COT-2031"
      }
    ],
    "actividades": [
      {
        "id": "ACT-77",
        "resumen": "Dar seguimiento por WhatsApp",
        "venceEn": "2026-10-08T17:00:00Z",
        "oportunidadId": "COT-2031"
      }
    ]
  }
}
```

**Seguimiento.** El puente recuerda cuándo cambió la etapa (la primera vez es
el `generadoEn` del envío; un `generadoEn` en el futuro se toma como ahora) y
cuándo vio por primera vez cada actividad ligada por `oportunidadId`. "Sin
movimiento" es el mayor de las dos fechas: un cambio de etapa o una actividad
nueva cuentan; reenviar lo mismo no. Con `reemplazar`, lo que ya no mandas se
olvida; con `agregar` se conserva.

**Mover la etapa desde el tablero.** En CRM, cada cotización trae un selector
de etapa. El cambio no toca tu sistema: el puente la sirve en la etapa nueva
(con "Movida aquí, falta confirmación del emisor") **aunque tú sigas mandando
otra**, hasta que la confirmes. Tu app lo recoge así, con su mismo token:

```
GET  {base}/ingesta/cambios
-> { "cambios": [ { "id": "COT-2031", "etapa": "negociacion",
                    "por": "ana@example.com", "en": "2026-10-06T16:20:00Z" } ] }

POST {base}/ingesta/cambios/confirmar
{ "ids": ["COT-2031"] }
-> { "confirmados": 1 }
```

- `id` es el que tú mandaste (sin el prefijo del emisor). `etapa` es una de
  `nuevo`, `calificado`, `propuesta`, `negociacion`, `ganado`, `perdido`: tradúcela
  a tus estados con la tabla de arriba.
- Solo ves y confirmas **lo tuyo**: el emisor sale del token. Un id que no es
  tuyo o no existe se ignora sin avisar (`confirmados` solo cuenta los tuyos).
- Para no confirmar un movimiento que no alcanzaste a leer, manda
  `{ "ids": [{ "id": "COT-2031", "en": "2026-10-06T16:20:00Z" }] }`: si
  alguien la movió otra vez después de tu lectura, ese nuevo cambio sigue
  pendiente.
- Una vez confirmado, vuelve a mandar tu etapa. Lo normal: aplicas el cambio en
  tu sistema, lo confirmas, y tu siguiente envío ya trae la etapa nueva.

**Pendiente por falta de movimiento.** Cada hora el puente revisa las
cotizaciones abiertas. Si una lleva más tiempo quieta del que corresponde a su
etapa (por omisión: Nuevo 1 día, Calificado 2, Propuesta 3, Negociación 5),
crea **un** pendiente propio, `cotizacion-{id}`: «Revisar cotización {nombre}
({cliente}): lleva N días en {etapa}», con la `url` de la cotización. El
responsable es el vendedor si coincide exactamente (correo o nombre completo)
con alguien del equipo; si no, el dueño. Al dueño no se le manda correo, y a
nadie se le repite el mismo aviso en 24 h. Si la cotización se mueve (etapa o
actividad nueva) o llega a Ganada/Perdida, el pendiente se marca hecho. Si lo
marcas hecho o lo borras a mano, no se recrea hasta que haya un movimiento
nuevo y vuelva a vencer (entonces se reabre el mismo). Un emisor que dejó de
mandar (pasó su ventana de frescura) no genera pendientes, y un emisor recién
conectado no inunda: máximo 20 pendientes nuevos por pasada.

Los días se cambian con `POST /crm/seguimiento/ajustes/guardar`
`{ "dias": { "propuesta": 7 } }` (entero de 0 a 365; `0` = no vigilar esa
etapa; `null` = volver al valor de fábrica) con sesión o el token de
administración, y se leen en `GET /crm/seguimiento/ajustes`. El portal todavía
no tiene pantalla para editarlos.

El portal las lee de `/ops/cotizaciones/opportunities` y `/activities` (todos
los emisores `crm` juntos), la conexión "Cotizaciones", que se enciende sola en
cuanto hay un emisor con tipo `crm`.

### Licencias — `POST /ingesta/licencias`

```json
{
  "version": 1,
  "datos": [
    {
      "id": "cursor-business",
      "producto": "Cursor Business",
      "proveedor": "cursor",
      "plan": "5 asientos",
      "unidad": "asientos",
      "usado": 5,
      "tope": 5,
      "periodoInicio": "2026-09-01T00:00:00Z",
      "periodoFin": "2026-10-01T00:00:00Z",
      "costo": 200,
      "moneda": "USD",
      "renuevaEn": "2026-09-18T00:00:00Z",
      "capturadoAMano": true,
      "url": "https://cursor.com/dashboard",
      "miembros": [
        { "persona": { "nombre": "Ana Robles" }, "usado": 1, "activo": true },
        { "persona": { "nombre": "Elena Paredes" }, "usado": 0, "activo": false }
      ]
    }
  ]
}
```

`unidad`: `asientos` · `tokens` · `solicitudes` · `dinero`
`proveedor`: `anthropic` · `cursor` · `figma` · `vercel` · `otro` (por omisión `otro`)

**`capturadoAMano` es `true` por omisión** en lo que llega por envío, porque
casi siempre viene de una hoja o de un script propio y no del proveedor. El
portal lo etiqueta como *Capturado a mano*. Si tu envío sí lee al proveedor,
manda `"capturadoAMano": false`.

Sin `tope` se entiende pago por consumo y no se dibuja barra.

### Despliegues — `POST /ingesta/despliegues`

Para eventos sueltos usa `"modo": "agregar"`.

```json
{
  "version": 1,
  "modo": "agregar",
  "datos": [
    {
      "id": "dpl_9f2c1ab",
      "proyecto": "portal-dealer",
      "url": "https://portal-dealer.example.mx",
      "estado": "success",
      "entorno": "produccion",
      "rama": "main",
      "commit": "9f2c1ab3d4e5f6a7",
      "mensaje": "Levantar el puente con seis conexiones",
      "autor": { "nombre": "Ana Robles" },
      "creadoEn": "2026-09-14T09:58:00Z",
      "listoEn": "2026-09-14T09:59:36Z",
      "enlaceDetalle": "https://ci.example.mx/run/4821"
    }
  ]
}
```

`estado` acepta el vocabulario de cualquier proveedor: `READY`, `success`,
`in_progress`, `failure`, `skipped`, `listo`, `fallido`... **Lo que no reconoce
se reporta como "en cola", nunca como "listo":** pintar de verde algo que no
sabemos que terminó es el peor error que puede cometer un tablero.

Si no mandas `duracionSegundos`, se calcula de `creadoEn` a `listoEn`.

### Repositorios — `POST /ingesta/repos`

Sirve para mandar el estado desde tu propio CI, o para no darle al puente un
token de GitHub. Si prefieres que el puente vaya por ellos, configura
`GITHUB_TOKEN` y `GITHUB_REPOS` y no necesitas este envío.

```json
{
  "version": 1,
  "datos": [
    {
      "nombre": "JcLimonero/VGD_SF_Track",
      "url": "https://github.com/JcLimonero/VGD_SF_Track",
      "privado": false,
      "ramaPrincipal": "main",
      "integracion": "fallido",
      "issuesAbiertos": 4,
      "ultimoPushEn": "2026-09-14T09:58:00Z",
      "ultimoCommit": {
        "sha": "9f2c1ab3d4e5f6a7",
        "mensaje": "Levantar el puente con seis conexiones",
        "autor": { "nombre": "Ana Robles" },
        "fecha": "2026-09-14T09:58:00Z",
        "url": "https://github.com/JcLimonero/VGD_SF_Track/commit/9f2c1ab"
      },
      "pullRequests": [
        {
          "numero": 38,
          "titulo": "Portal de pendientes y monitoreo",
          "url": "https://github.com/JcLimonero/VGD_SF_Track/pull/38",
          "autor": { "nombre": "Juan Carlos" },
          "creadoEn": "2026-09-10T16:00:00Z",
          "actualizadoEn": "2026-09-14T09:58:00Z",
          "borrador": false,
          "revision": "cambios_solicitados",
          "integracion": "exitoso"
        }
      ]
    }
  ]
}
```

`nombre` es también el identificador, así que debe ser estable.
`integracion`: `exitoso` · `fallido` · `en_curso` · `sin_revision`
`revision`: `aprobado` · `cambios_solicitados` · `sin_revisar`

### Ejecuciones — `POST /ingesta/ejecuciones`

No es un envío de datos: es "corrí, y me fue así". Cada aplicación que corre
(una sincronía con Odoo, un barrido de correo, un cron, un job de CI) lo manda
al terminar y el puente guarda **solo la última corrida** de cada integración,
con cuántas veces ha corrido y cuántas seguidas ha fallado. Se ve en el portal
en **Ejecuciones**, y las que fallan o se atrasan salen en **Hoy**.

El emisor necesita el tipo `ejecuciones`. El cuerpo no lleva `version` ni
`datos`: es un objeto plano.

```json
{
  "integracion": "odoo-sync",
  "nombre": "Sincronía con Odoo",
  "estado": "ok",
  "mensaje": "48 facturas, 3 nuevas",
  "detalle": "Texto largo opcional: el error completo, cifras, lo que quieras dejar.",
  "duracionMs": 1520,
  "cadaMinutos": 60
}
```

- `integracion` (obligatorio): identificador corto y estable, se normaliza a
  minúsculas con guiones. La misma integración desde dos emisores son dos
  renglones.
- `estado` (obligatorio): `ok` · `aviso` · `error`. También vale `"ok": true`
  o `"ok": false`, o `resultado` en lugar de `estado`.
- `nombre`: cómo se muestra; si no viene se usa el identificador (o el nombre
  que se mandó antes).
- `mensaje`: una línea (hasta 240 caracteres). `detalle`: hasta 4 000.
- `duracionMs`, o bien `empezoEn` y `terminoEn` en ISO 8601 (se calcula).
  Si no mandas `terminoEn`, cuenta la hora en que llegó.
- `cadaMinutos`: cada cuánto debería correr. Si pasa vez y media ese tiempo
  (mínimo cinco minutos de holgura) sin una corrida nueva, se marca
  **atrasada**. Se recuerda entre envíos: basta mandarlo una vez.

Respuesta:

```json
{
  "recibido": true,
  "integracion": "odoo-sync",
  "resultado": "ok",
  "corridas": 12,
  "erroresSeguidos": 0,
  "recibidoEn": "2026-09-18T07:30:00.000Z"
}
```

Con `curl`, desde cualquier script:

```bash
curl -sS -X POST "$PUENTE/ingesta/ejecuciones" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"integracion":"barrido-correo","ok":true,"duracionMs":812,"cadaMinutos":15}'
```

El portal lo lee en `GET /ejecuciones` (con sesión), ya con el estado
calculado (`ok`, `aviso`, `error` o `atrasada`) y lo que está mal primero.

---

## Leer lo recibido

El portal lo pide en:

```
GET {base}/recibido/{emisor}/{recurso}
```

| Tipo enviado | Recurso que lee el portal |
| --- | --- |
| `pendientes` | `/recibido/{emisor}/tasks` (y todos juntos en `/ops/pendientes/tasks`) |
| `equipo` | `/recibido/{emisor}/team` (y mezclado en `/equipo`) |
| `juntas` | `/recibido/{emisor}/meetings` |
| `monitoreo` | `/recibido/{emisor}/targets` |
| `crm` | `/recibido/{emisor}/opportunities` y `/activities` (y todos juntos en `/ops/cotizaciones/…`, con el seguimiento) |
| `licencias` | `/recibido/{emisor}/licenses` |
| `despliegues` | `/recibido/{emisor}/deployments` |
| `repos` | `/recibido/{emisor}/repos` |

`GET {base}/ingesta/estado` dice qué emisores hay, qué rutas alimentan, cuándo
llegó su último envío y cuáles ya vencieron. **No expone ningún token**, ni
recortado.

---

## Reglas que conviene conocer

**Los envíos fuera de orden se descartan.** Si llega uno cuyo `generadoEn` es
anterior al último recibido, se ignora y la respuesta lo dice. Con reintentos y
webhooks esto pasa más seguido de lo que uno cree, y dejar que un dato viejo
pise a uno nuevo es peor que perder el viejo. **Manda siempre `generadoEn`** con
el momento de la medición.

**Lo recibido sobrevive a un reinicio.** Se escribe a disco. Con pull, un
reinicio se cura solo en el siguiente ciclo; con push, el portal se quedaría en
blanco hasta el siguiente envío, que puede ser en horas.

**Un emisor que deja de mandar se nota.** Cada uno tiene una ventana de
frescura (el último campo de `INGESTA_CLIENTES`). Pasada esa ventana, su ruta
responde 503 explicando de cuándo es el último envío. El portal lo marca como
fuente con error. Servir datos de hace horas como si fueran de ahora es peor que
no servir nada.

**La validación falla en vez de corregir.** Un `estado` que no existe en la
lista no se convierte en silencio al valor por omisión: el envío se rechaza con
un mensaje que dice el campo y el renglón exacto —
`datos[1].titulo es obligatorio y debe ser texto`. Si el emisor está mandando un
campo mal, más vale enterarse el primer día.

**Los identificadores llevan prefijo del emisor.** El pendiente `482` de Ops
llega al portal como `ops-482`. Sin eso, el pendiente 482 de un sistema y el de
otro serían el mismo y el portal mostraría solo uno.

**Tope de tamaño.** 512 kB por envío por omisión (`INGESTA_MAXIMO_KB`). Si tu
lista no cabe, pártela y usa `modo: "agregar"`.

---

## CRM nativo

El CRM nativo de DS Monitor permite llevar clientes, contactos, proyectos,
cotizaciones, pagos programados, actividades y funcionalidades de desarrollo.
**No depende de Odoo ni de ningún emisor externo**; vive en el puente con
persistencia propia (Postgres o archivos).

Empresas del CRM: TechCorp, InnovateLabs, CloudWorks, DevHub, LimonLabs.
(Los nombres de empresas y datos en los ejemplos son ficticios.)

### Modelo de datos

| Entidad | Descripción |
|---------|-------------|
| **Cliente** | Nombre, razón social, RFC, tipo (directo/intermediario/final), enlace a Drive |
| **Contacto** | Por cliente: nombre, puesto, correo, teléfono, si es responsable de proyectos |
| **Proyecto** | Por cliente: nombre, alcance, empresa que atiende, responsable interno y del cliente, estado, avance, repos |
| **Cotización** | Por proyecto: folio, versión, empresa que factura, montos, esquema de cobro, estatus, autorización de Carlos |
| **PagoProgramado** | Por cotización: parcialidades o mensualidades con fecha esperada y estatus |
| **Actividad** | Bitácora por cliente: llamada, junta, correo, nota, próximo paso |
| **Funcionalidad** | Por proyecto: tareas de desarrollo con estado, responsable, prioridad, enlace a repo/PR |

### Control de acceso por roles

El CRM tiene control de acceso por roles. Carlos (Director) ve todo. Los demás
usuarios ven según sus roles y alcance.

**Roles de fábrica:**

| Rol | Acceso |
|-----|--------|
| Director | Todo (licencias, correo, servidores, integraciones, configuración) |
| Finanzas | Cotizaciones (lectura), cobranza (escritura), costos (lectura) |
| Comercial | Clientes (escritura), proyectos (lectura), cotizaciones (lectura, sin costos), actividades (escritura) |
| Desarrollo | Proyectos (lectura), funcionalidades (escritura), sin importes |

Un usuario puede tener varios roles y un alcance limitado (solo ciertos
proyectos, clientes o empresas). **El filtrado se hace en el puente**: las rutas
no devuelven campos ni registros fuera del permiso.

### API con token de emisor — `POST /ingesta/clientes`

Un sistema externo o bot puede crear/actualizar clientes, contactos, proyectos y
actividades con su token de emisor. El emisor necesita el tipo `clientes`.

```json
{
  "version": 1,
  "modo": "agregar",
  "generadoEn": "2026-10-10T12:00:00Z",
  "datos": {
    "clientes": [
      {
        "id": "acme-motors",
        "nombre": "Acme Motors",
        "razonSocial": "Acme Motors SA de CV",
        "rfc": "AMO850101XXX",
        "tipo": "directo",
        "driveFolderUrl": "https://drive.google.com/drive/folders/..."
      }
    ],
    "contactos": [
      {
        "id": "juan-perez",
        "clienteId": "acme-motors",
        "nombre": "Juan Pérez García",
        "puesto": "Gerente de Sistemas",
        "correo": "sistemas@example.com",
        "esResponsableProyecto": true
      }
    ],
    "proyectos": [
      {
        "id": "sistema-tickets",
        "clienteId": "acme-motors",
        "empresaAtiendeId": "techcorp",
        "nombre": "Migración GLPI",
        "estado": "en_desarrollo",
        "responsableClienteId": "juan-perez"
      }
    ],
    "actividades": [
      {
        "clienteId": "acme-motors",
        "proyectoId": "sistema-tickets",
        "tipo": "junta",
        "resumen": "Revisión semanal de avances",
        "fecha": "2026-10-10T10:00:00Z"
      }
    ]
  }
}
```

**Campos de cliente:** `id`, `nombre` (obligatorio), `razonSocial`, `rfc`,
`tipo` (`directo`|`intermediario`|`final`), `clienteFacturacionId`, `driveFolderUrl`, `notas`.

**Campos de contacto:** `id`, `clienteId` (obligatorio), `nombre` (obligatorio),
`puesto`, `correo`, `telefono`, `esResponsableProyecto`.

**Campos de proyecto:** `id`, `clienteId` (obligatorio), `clienteFinalId`,
`empresaAtiendeId`, `nombre` (obligatorio), `alcance`, `responsableInterno`
(objeto con `name`, `email`), `responsableClienteId`, `fechaInicio`,
`fechaFinEstimada`, `estado` (ver abajo), `avancePct`, `driveUrl`, `repos`, `notas`.

**Estados de proyecto:** `prospecto`, `en_cotizacion`, `aprobado`, `en_desarrollo`,
`en_pruebas`, `entregado`, `en_soporte`, `pausado`, `cancelado`.

**Campos de actividad:** `id`, `clienteId` (obligatorio), `proyectoId`,
`cotizacionId`, `tipo` (`llamada`|`junta`|`correo`|`nota`), `resumen` (obligatorio),
`fecha`, `proximoPaso` (objeto con `descripcion` y `fecha`), `responsable`.

### API para funcionalidades — `POST /ingesta/funcionalidades`

Un sistema externo puede crear/actualizar funcionalidades de desarrollo. El
emisor necesita el tipo `funcionalidades`.

```json
{
  "version": 1,
  "modo": "agregar",
  "datos": [
    {
      "id": "func-login",
      "proyectoId": "sistema-tickets",
      "titulo": "Implementar login SSO",
      "descripcion": "Integrar con Active Directory del cliente",
      "estado": "en_progreso",
      "responsableId": "giovana",
      "prioridad": "alta",
      "fechaCompromiso": "2026-10-15T00:00:00Z",
      "enlace": "https://github.com/org/repo/pull/42"
    }
  ]
}
```

**Estados de funcionalidad:** `por_hacer`, `en_progreso`, `en_revision`, `hecho`, `bloqueado`.

**Prioridades:** `baja`, `media`, `alta`, `urgente`.

### Consultar responsable de proyecto — `GET /crm/proyectos/:id/responsable`

Devuelve el responsable del lado del cliente para un proyecto. Útil para que un
bot sepa a quién enviar una cotización autorizada.

```json
{
  "nombre": "Juan Pérez García",
  "correo": "sistemas@example.com",
  "puesto": "Gerente de Sistemas"
}
```

### Registrar envío de cotización — `POST /crm/cotizaciones/:id/envio`

Registra que una cotización ya autorizada se envió al cliente. El bot llama
esto después de enviar el correo.

```json
{
  "enviadaA": {
    "nombre": "Juan Pérez García",
    "correo": "sistemas@example.com"
  },
  "fechaEnvio": "2026-10-10T14:30:00Z"
}
```

La cotización debe estar autorizada (`autorizadaPorCarlosEn` no vacío) para
poder marcarla como enviada.

---

## Ingesta del CRM nativo (rutas directas)

El CRM nativo también acepta carga directa de datos sin el sobre estándar.
Estas rutas son más simples y están diseñadas para carga masiva desde un bot
o script externo.

**El emisor necesita el tipo `crm-nativo`.** Todas las rutas requieren
`Authorization: Bearer <token>`.

### Clientes — `POST /ingesta/crm-nativo/clientes`

```json
[
  {
    "id": "acme-motors",
    "nombre": "Acme Motors",
    "razonSocial": "Acme Motors SA de CV",
    "rfc": "AMO850101XXX",
    "tipo": "directo",
    "driveFolderUrl": "https://drive.google.com/drive/folders/..."
  }
]
```

### Contactos — `POST /ingesta/crm-nativo/contactos`

```json
[
  {
    "id": "juan-perez",
    "clienteId": "acme-motors",
    "nombre": "Juan Pérez García",
    "puesto": "Gerente de Sistemas",
    "correo": "sistemas@example.com",
    "esResponsableProyecto": true
  }
]
```

### Proyectos — `POST /ingesta/crm-nativo/proyectos`

```json
[
  {
    "id": "sistema-tickets",
    "clienteId": "acme-motors",
    "empresaAtiendeId": "techcorp",
    "nombre": "Migración GLPI",
    "estado": "en_desarrollo",
    "responsableClienteId": "juan-perez"
  },
  {
    "id": "proyecto-sin-estado",
    "clienteId": "acme-motors",
    "nombre": "Propuesta consultoría",
    "notas": "Proyecto en evaluación, estado por confirmar"
  }
]
```

**Notas importantes:**

- **`estado` es opcional**: si no se conoce, se omite o se usa `por_confirmar`.
  Ya no se asigna `prospecto` por omisión.
- Estados válidos: `prospecto`, `en_cotizacion`, `aprobado`, `en_desarrollo`,
  `en_pruebas`, `entregado`, `en_soporte`, `pausado`, `cancelado`, `por_confirmar`.

### Cotizaciones — `POST /ingesta/crm-nativo/cotizaciones`

```json
[
  {
    "id": "cot-12345",
    "proyectoId": "sistema-tickets",
    "folio": "COT-2026-042",
    "empresaFacturaId": "techcorp",
    "nombre": "Implementación GLPI fase 1",
    "subtotal": 150000,
    "iva": 24000,
    "total": 174000,
    "moneda": "MXN",
    "esquemaCobro": "parcialidades",
    "estatus": "enviada",
    "cotizacionExternaId": "1234567890abcdef/COT-2026-042.pdf",
    "notas": "50% al iniciar, 50% al entregar"
  },
  {
    "id": "cot-sin-proyecto",
    "clienteId": "acme-motors",
    "nombre": "Propuesta inicial consultoría",
    "total": null,
    "estatus": "desconocido",
    "notas": "Monto por definir en reunión, IVA por confirmar"
  },
  {
    "id": "cot-interna",
    "clienteId": "techcorp",
    "empresaFacturaId": "innovatelabs",
    "empresaReceptoraId": "techcorp",
    "tipo": "interna",
    "nombre": "Desarrollo componente React",
    "subtotal": 80000,
    "iva": 12800,
    "total": 92800,
    "esquemaCobro": "mensual"
  }
]
```

**Notas importantes para la carga inicial:**

- **El `id` es la llave única**, no el folio. El folio es opcional y no único.
- **`proyectoId` ahora es opcional**: si no hay proyecto, usa `clienteId`.
- **`cotizacionExternaId`** es la llave externa para idempotencia: si ya existe
  un registro con ese valor, se actualiza en lugar de crear uno nuevo. Úsalo
  para identificar el documento original (por ejemplo, la ruta del PDF en
  Drive: `"folder-id/nombre-archivo.pdf"`).
- **`estatus`** ya no tiene valor por omisión. Si no lo conoces, omítelo.
  `"desconocido"` es válido para cotizaciones sin resultado conocido.
- **`subtotal`, `iva`, `total` pueden ser `null`** (sin monto, distinto de 0).
  Las sumas en cobranza ignoran valores nulos; la UI muestra "sin monto".
- **`esquemaCobro`** acepta: `unico`, `parcialidades`, `mensual`, `mixto`,
  `anual`, `cuatrimestral`, `bolsa_horas`, `por_definir`. Puede ser `null` si
  no se conoce. Ya no tiene valor por omisión.
- **`tipo`**: `venta` (ingreso a cliente), `interna` (entre empresas propias),
  `gasto` (de proveedor hacia empresa). Por omisión `venta`.
- **`empresaReceptoraId`**: para cotizaciones internas o gastos, indica quién
  recibe la cotización.
- **`notas`**: texto libre para evidencia del estatus, esquema de cobro
  original, "IVA por confirmar", etc.
- La respuesta incluye cuántos se crearon, actualizaron y errores por índice.

### Pagos programados — `POST /ingesta/crm-nativo/pagos`

```json
[
  {
    "id": "pago-1-cot-12345",
    "cotizacionId": "cot-12345",
    "numero": 1,
    "totalPagos": 2,
    "monto": 87000,
    "moneda": "MXN",
    "fechaEsperada": "2026-10-15T00:00:00Z",
    "estatus": "por_facturar"
  },
  {
    "id": "pago-sin-cot-1",
    "proyectoId": "sistema-tickets",
    "nota": "Mensualidad soporte Noviembre 2026",
    "monto": 15000,
    "moneda": "MXN",
    "fechaEsperada": "2026-11-01T00:00:00Z",
    "estatus": "por_facturar"
  },
  {
    "id": "pago-por-confirmar",
    "proyectoId": "sistema-tickets",
    "nota": "Pago final (monto por definir)",
    "monto": null,
    "fechaEsperada": null,
    "fechaPorConfirmar": true,
    "estatus": "por_confirmar"
  }
]
```

**Notas importantes:**

- **`cotizacionId` ahora es opcional**: usa `proyectoId` para pagos sin
  cotización emitida (ej. mensualidades de soporte), o `clienteId` si tampoco
  hay proyecto.
- **`monto` puede ser `null`** (monto por confirmar, distinto de 0). Las sumas
  en cobranza ignoran valores nulos; la UI muestra "sin monto".
- **`fechaEsperada` puede ser `null`** o `fechaPorConfirmar: true` para fechas
  pendientes de definir. La UI muestra "por confirmar".
- **`numero` y `totalPagos` son opcionales** para pagos por confirmar.
- **`estatus`** acepta: `por_facturar`, `facturado`, `pagado`, `vencido`,
  `por_confirmar`. Ya no tiene valor por omisión.

### Actividades — `POST /ingesta/crm-nativo/actividades`

```json
[
  {
    "clienteId": "acme-motors",
    "proyectoId": "sistema-tickets",
    "tipo": "junta",
    "resumen": "Revisión semanal de avances",
    "fecha": "2026-10-10T10:00:00Z"
  }
]
```

### Funcionalidades — `POST /ingesta/crm-nativo/funcionalidades`

```json
[
  {
    "id": "func-login",
    "proyectoId": "sistema-tickets",
    "titulo": "Implementar login SSO",
    "estado": "en_progreso",
    "responsableId": "giovana",
    "prioridad": "alta",
    "fechaCompromiso": "2026-10-15T00:00:00Z"
  }
]
```

### Órdenes de compra — `POST /ingesta/crm-nativo/ordenes-compra`

Órdenes de compra recurrentes por cliente/mes, ligadas opcionalmente a pagos.

```json
[
  {
    "id": "oc-acme-oct-2026",
    "clienteId": "acme-motors",
    "proyectoId": "sistema-tickets",
    "folio": "OC-2026-0042",
    "periodo": "Octubre 2026",
    "monto": 50000,
    "moneda": "MXN",
    "fechaEmision": "2026-10-01T00:00:00Z",
    "fechaVencimiento": "2026-10-31T00:00:00Z",
    "pagoIds": ["pago-1-cot-12345", "pago-2-cot-12345"]
  },
  {
    "id": "oc-pendiente",
    "clienteId": "acme-motors",
    "folio": "OC-2026-0050",
    "periodo": "Q4 2026",
    "monto": null,
    "notas": "Monto por definir en junta de presupuesto"
  }
]
```

**Campos:** `id`, `clienteId` (obligatorio), `proyectoId`, `folio` (obligatorio),
`periodo`, `monto` (null = por confirmar), `moneda`, `fechaEmision`,
`fechaVencimiento`, `pagoIds` (arreglo de IDs de pagos cubiertos), `notas`.

### Facturas — `POST /ingesta/crm-nativo/facturas`

Facturas emitidas, ligadas a pagos. Se usa el `uuid` como llave externa para
idempotencia: si ya existe una factura con ese UUID, se actualiza.

```json
[
  {
    "id": "fac-001",
    "empresaEmisoraId": "techcorp",
    "clienteId": "acme-motors",
    "proyectoId": "sistema-tickets",
    "uuid": "ABCD1234-5678-90EF-GHIJ-KLMNOPQRSTUV",
    "folio": "A-1234",
    "fechaEmision": "2026-10-10T00:00:00Z",
    "subtotal": 75000,
    "iva": 12000,
    "total": 87000,
    "moneda": "MXN",
    "fechaPagoReal": "2026-10-15T00:00:00Z",
    "tieneComplemento": true,
    "fechaComplemento": "2026-10-20T00:00:00Z",
    "uuidComplemento": "WXYZ1234-5678-90AB-CDEF-GHIJKLMNOPQR",
    "pagoIds": ["pago-1-cot-12345"],
    "archivoUrl": "https://drive.example.com/facturas/A-1234.pdf"
  }
]
```

**Campos:** `id`, `empresaEmisoraId` (obligatorio), `clienteId` (obligatorio),
`proyectoId`, `uuid` (CFDI), `folio`, `fechaEmision`, `subtotal`, `iva`, `total`
(null = sin monto), `moneda`, `fechaPagoReal`, `tieneComplemento`,
`fechaComplemento`, `uuidComplemento`, `pagoIds`, `archivoUrl`, `notas`.

### Partidas — `POST /ingesta/crm-nativo/partidas`

Partidas (líneas) de una cotización, con costo para calcular margen. Los campos
de costo (`costoUnitario`, `costoTotal`) solo son visibles con permiso de costos.

```json
[
  {
    "id": "part-cot-12345-1",
    "cotizacionId": "cot-12345",
    "numero": 1,
    "descripcion": "Desarrollo módulo principal",
    "cantidad": 1,
    "precioUnitario": 100000,
    "importe": 100000,
    "costoUnitario": 60000,
    "costoTotal": 60000,
    "moneda": "MXN"
  },
  {
    "id": "part-cot-12345-2",
    "cotizacionId": "cot-12345",
    "numero": 2,
    "descripcion": "Capacitación (8 horas)",
    "cantidad": 8,
    "precioUnitario": 2500,
    "importe": 20000,
    "costoUnitario": 1000,
    "costoTotal": 8000
  }
]
```

**Campos:** `id`, `cotizacionId` (obligatorio), `numero`, `descripcion`
(obligatorio), `cantidad`, `precioUnitario`, `importe` (null = sin precio),
`costoUnitario`, `costoTotal` (null = sin costo), `moneda`, `notas`.

El margen se calcula como `(venta - costo) / venta * 100`. Solo disponible con
permiso de `costos`.

### Empresas del grupo — `POST /ingesta/crm-nativo/empresas`

El catálogo de empresas del grupo es editable en producción desde
Integraciones → Empresas en el portal, o por ingesta con esta ruta. Cada
empresa identifica a una entidad que factura o atiende clientes.

```json
[
  {
    "id": "limonlabs",
    "nombre": "LimonLabs",
    "descripcion": "laboratorio de innovación y prototipos",
    "color": "lime",
    "cuentas": ["correo-limon"],
    "activa": true
  }
]
```

**Campos:** `id` (se genera del nombre si no viene), `nombre` (obligatorio),
`descripcion` (lo que se le cuenta al modelo de IA), `color` (nombre Tailwind:
violet, cyan, emerald, orange, lime, etc.), `cuentas` (IDs de buzones que le
pertenecen), `activa` (por omisión `true`).

**Notas:**

- Una empresa inactiva no se ofrece en selectores ni al modelo de IA.
- El `color` se usa para la etiqueta en la UI.
- Los nombres de empresa y datos en los ejemplos son ficticios.

### Cambios de etapa comercial — `POST /ingesta/crm-nativo/cambios-etapa`

Historial de cambios de etapa en el kanban comercial. Se registra automáticamente
al mover un proyecto entre columnas, o puede alimentarse desde un bot.

```json
[
  {
    "id": "ce-sistema-tickets-2026-10-10",
    "proyectoId": "sistema-tickets",
    "etapaAnterior": "prospecto",
    "etapaNueva": "en_cotizacion",
    "autor": { "name": "Ana García", "email": "ana@ficticio.com" },
    "fecha": "2026-10-10T14:30:00Z",
    "nota": "Se agendó junta de levantamiento"
  }
]
```

**Campos:** `id`, `proyectoId` (obligatorio), `etapaAnterior`, `etapaNueva`
(obligatorio, valores: `prospecto`, `en_cotizacion`, `cotizacion_enviada`,
`negociacion`, `ganado`, `perdido`, `por_confirmar`), `autor` (Person),
`fecha`, `nota`.

### Avances de proyecto — `POST /ingesta/crm-nativo/avances`

Línea de tiempo de avances y actualizaciones de estatus. Útil para alimentar
el seguimiento desde dailies, correos o Teams automáticamente.

```json
[
  {
    "id": "av-sistema-tickets-2026-10-10",
    "proyectoId": "sistema-tickets",
    "fecha": "2026-10-10T10:00:00Z",
    "nota": "Se completó el módulo de autenticación. Siguiente: reportes.",
    "avancePct": 45,
    "fuente": "daily",
    "autor": { "name": "Carlos Méndez", "email": "carlos@ficticio.com" },
    "estadoAnterior": "en_desarrollo",
    "estadoNuevo": "en_desarrollo"
  }
]
```

**Campos:** `id`, `proyectoId` (obligatorio), `fecha`, `nota` (obligatorio),
`avancePct` (0–100), `fuente` (obligatorio: `daily`, `correo`, `teams`,
`manual`, `bot`), `autor` (Person), `estadoAnterior`, `estadoNuevo`.

### Hitos — `POST /ingesta/crm-nativo/hitos`

Hitos o entregables del proyecto con fecha compromiso y fecha real.

```json
[
  {
    "id": "hito-sistema-tickets-login",
    "proyectoId": "sistema-tickets",
    "nombre": "Entrega módulo de login",
    "descripcion": "Login SSO con Microsoft Entra ID",
    "fechaCompromiso": "2026-10-15T00:00:00Z",
    "fechaReal": null,
    "completado": false,
    "orden": 1
  },
  {
    "id": "hito-sistema-tickets-reportes",
    "proyectoId": "sistema-tickets",
    "nombre": "Entrega reportes básicos",
    "fechaCompromiso": "2026-10-30T00:00:00Z",
    "completado": false,
    "orden": 2
  }
]
```

**Campos:** `id`, `proyectoId` (obligatorio), `nombre` (obligatorio),
`descripcion`, `fechaCompromiso`, `fechaReal`, `completado` (boolean),
`orden` (para ordenar en la UI).

### Riesgos — `POST /ingesta/crm-nativo/riesgos`

Riesgos potenciales o bloqueos activos del proyecto.

```json
[
  {
    "id": "riesgo-sistema-tickets-1",
    "proyectoId": "sistema-tickets",
    "tipo": "riesgo",
    "descripcion": "El cliente puede tardar en entregar los datos de prueba",
    "impacto": "Retraso de 1 semana en las pruebas",
    "mitigacion": "Solicitar datos de prueba con anticipación",
    "reportadoPor": { "name": "Ana García", "email": "ana@ficticio.com" },
    "fechaReporte": "2026-10-05T00:00:00Z",
    "abierto": true
  },
  {
    "id": "bloqueo-sistema-tickets-1",
    "proyectoId": "sistema-tickets",
    "tipo": "bloqueo",
    "descripcion": "Falta acceso al servidor de staging",
    "impacto": "No se puede desplegar para pruebas",
    "mitigacion": "Escalar con TI del cliente",
    "fechaReporte": "2026-10-08T00:00:00Z",
    "abierto": true
  }
]
```

**Campos:** `id`, `proyectoId` (obligatorio), `tipo` (obligatorio: `riesgo`
o `bloqueo`), `descripcion` (obligatorio), `impacto`, `mitigacion`,
`reportadoPor` (Person), `fechaReporte`, `abierto` (boolean),
`fechaCierre`.

### Asignar responsable en lote — `POST /ingesta/crm-nativo/asignar-responsable`

Asigna responsable a funcionalidades y hitos existentes por ID. Útil para
que un bot proponga asignaciones después de consultar las tareas sin responsable.

```json
{
  "funcionalidades": [
    { "id": "func-login", "responsableId": "giovana" },
    { "id": "func-reportes", "responsableId": "carlos" }
  ],
  "hitos": [
    { "id": "hito-sistema-tickets-login" }
  ]
}
```

**Respuesta:**

```json
{
  "funcionalidades": 2,
  "hitos": 1
}
```

---

## Rutas de lectura para bots (tipo `lectura-tareas`)

Para que un bot pueda leer tareas sin responsable y el catálogo del equipo,
el emisor debe tener el tipo `lectura-tareas` en su lista de permisos. Este
tipo se agrega desde el panel de emisores en Integraciones.

### Tareas sin responsable — `GET /lectura/tareas-sin-responsable`

Devuelve todas las tareas (pendientes de cualquier origen, funcionalidades,
hitos y riesgos) que no tienen responsable asignado.

**Encabezado:** `Authorization: Bearer <token>`

**Respuesta:**

```json
{
  "total": 5,
  "pendientes": [
    {
      "tipo": "pendiente",
      "id": "task-12345",
      "titulo": "Revisar propuesta de diseño",
      "origen": "correo",
      "proyecto": null,
      "actualizado": "2026-10-10T08:00:00Z"
    }
  ],
  "funcionalidades": [
    {
      "tipo": "funcionalidad",
      "id": "func-login",
      "titulo": "Implementar login SSO",
      "origen": "crm-nativo",
      "proyecto": { "id": "sistema-tickets", "nombre": "Sistema de tickets" },
      "creado": "2026-10-01T00:00:00Z",
      "actualizado": "2026-10-05T00:00:00Z"
    }
  ],
  "hitos": [
    {
      "tipo": "hito",
      "id": "hito-sistema-tickets-login",
      "titulo": "Entrega módulo de login",
      "origen": "crm-nativo",
      "proyecto": { "id": "sistema-tickets", "nombre": "Sistema de tickets" },
      "fechaCompromiso": "2026-10-15T00:00:00Z",
      "completado": false,
      "creado": "2026-10-01T00:00:00Z",
      "actualizado": "2026-10-01T00:00:00Z"
    }
  ],
  "riesgos": [
    {
      "tipo": "riesgo",
      "id": "riesgo-sistema-tickets-1",
      "titulo": "El cliente puede tardar en entregar los datos...",
      "origen": "crm-nativo",
      "proyecto": { "id": "sistema-tickets", "nombre": "Sistema de tickets" },
      "tipoRiesgo": "riesgo",
      "creado": "2026-10-05T00:00:00Z",
      "actualizado": "2026-10-05T00:00:00Z"
    }
  ]
}
```

### Catálogo del equipo — `GET /lectura/equipo`

Devuelve la lista del equipo con nombre, correo y roles CRM asignados.

**Encabezado:** `Authorization: Bearer <token>`

**Respuesta:**

```json
[
  {
    "nombre": "Ana García",
    "correo": "ana@ficticio.com",
    "roles": [
      { "id": "comercial", "nombre": "Comercial" },
      { "id": "desarrollo", "nombre": "Desarrollo" }
    ]
  },
  {
    "nombre": "Carlos Méndez",
    "correo": "carlos@ficticio.com",
    "roles": [
      { "id": "desarrollo", "nombre": "Desarrollo" }
    ]
  }
]
```

**Notas:**

- El bot puede usar esta información para proponer asignaciones inteligentes.
- Después de consultar tareas sin responsable y el equipo, el bot puede llamar
  a `POST /ingesta/crm-nativo/asignar-responsable` para asignarlas.

### Respuesta de las rutas de ingesta

Todas las rutas devuelven el mismo formato:

```json
{
  "recibidos": 10,
  "creados": 8,
  "actualizados": 2,
  "errores": ["[3] El campo 'nombre' es obligatorio"]
}
```

Los errores incluyen el índice del registro que falló. Los registros válidos
se guardan aunque otros fallen.
