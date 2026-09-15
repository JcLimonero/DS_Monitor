# DS Monitor

Una sola pantalla para lo que hoy está repartido en muchos lugares: los
pendientes propios y los del equipo, las juntas de las distintas cuentas de
correo, el estado de los sitios y servicios desplegados, los despliegues, los
repositorios, el consumo de las licencias (Claude, Cursor, Figma, Vercel) y el
embudo del CRM.

Se usa de dos maneras:

- **Como portal**, en la computadora, con barra lateral y filtros.
- **Como carrusel**, en el monitor fijo de la oficina: a pantalla completa,
  turnando ocho pantallas solo, sin que nadie lo opere.

## Los dos proyectos

| Carpeta | Qué es | Cómo se levanta |
| --- | --- | --- |
| [`portal/`](portal) | El tablero. Angular 20 sin zone.js, Tailwind con la paleta de Dealer Solutions | `cd portal && npm install && npm start` |
| [`puente/`](puente) | El backend: guarda las credenciales, consulta o recibe los datos, y los traduce al modelo del portal. Node 22, cero dependencias en tiempo de ejecución | `cd puente && npm install && npm run build && npm start` |

Cada uno tiene su `package.json` y su job en [CI](.github/workflows/ci.yml).

## Cómo está pensado

**El portal no conoce a ningún proveedor.** Conoce siete interfaces
(`TaskSource`, `CalendarSource`, `MonitorSource`, `CrmSource`, `LicenseSource`,
`DeploymentSource`, `RepoSource`). Cada integración es una clase que las
implementa, y una línea de configuración decide si esa conexión corre con datos
de demostración o contra el puente. Conectar una fuente real no cambia una sola
vista.

**El puente trae los datos de dos maneras:**

- *Yendo por ellos* — consulta la API del proveedor. Hoy: Claude, Cursor, Figma,
  Vercel, GitHub, Odoo y el monitoreo propio.
- *Recibiéndolos* — el sistema de origen empuja con un token. Es lo natural para
  lo nuestro (Ops, el CI, un script de vigilancia) y no requiere darle al puente
  credenciales de esos sistemas. El cuerpo exacto de cada envío está en
  [`puente/INGESTA.md`](puente/INGESTA.md).

Recibir trae tres problemas que ir por los datos no tiene, y los tres están
resueltos: los envíos llegan fuera de orden (se descartan por `generadoEn`), un
reinicio borraría lo recibido (se escribe a disco), y un emisor que deja de
mandar no se nota (cada uno tiene ventana de frescura y su ruta responde 503 al
vencerse).

## Estado

**Todas las fuentes del portal corren en modo demostración.** Los datos son
inventados, y los nombres de personas, clientes y dominios también.

El puente ya existe con siete conexiones listas. Para encender una: llenar sus
variables en `puente/.env`, levantarlo, y cambiar el `mode` de esa conexión de
`demo` a `gateway` en `portal/src/app/core/config/portal-defaults.ts`. Se pueden
conectar de una en una — una conexión sin credencial responde 503 diciendo qué
falta, y las demás siguen funcionando.

Sin construir todavía: los calendarios de Google y Microsoft del lado del
puente. Ops ya se puede resolver por envío.

Los detalles de cada lado están en [`portal/README.md`](portal/README.md) y
[`puente/README.md`](puente/README.md).

## Dónde no van las credenciales

En el repositorio. Usuarios, llaves y tokens viven en el entorno del puente (ver
[`puente/.env.example`](puente/.env.example)), y lo que el puente recibe se
guarda en `puente/datos/`, que está en `.gitignore` porque puede traer nombres,
correos e importes reales.
