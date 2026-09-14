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
`repos`.

**El emisor se identifica por el token, nunca por el cuerpo.** Así nadie puede
escribir en el buzón de otro cambiando un campo del JSON. Cada token trae de
fábrica qué tipos puede mandar y con qué cuenta del portal se marcan sus datos;
eso se configura en `INGESTA_CLIENTES` (ver `.env.example`).

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
      "id": "api-vanguardia",
      "nombre": "API Vanguardia",
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

---

## Leer lo recibido

El portal lo pide en:

```
GET {base}/recibido/{emisor}/{recurso}
```

| Tipo enviado | Recurso que lee el portal |
| --- | --- |
| `pendientes` | `/recibido/{emisor}/tasks` |
| `juntas` | `/recibido/{emisor}/meetings` |
| `monitoreo` | `/recibido/{emisor}/targets` |
| `crm` | `/recibido/{emisor}/opportunities` y `/activities` |
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
