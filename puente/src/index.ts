import { createServer } from 'node:http';
import { leerConfiguracion } from './config/entorno.js';
import { AlmacenCorreo } from './correo/almacen-correo.js';
import { AlmacenIngesta } from './ingesta/almacen.js';
import {
  AlmacenIntegraciones,
  Configurador
} from './integraciones/almacen-integraciones.js';
import { Cache } from './nucleo/cache.js';
import {
  abrirDatos,
  construirRutas,
  estadoDeConexiones
} from './servidor/rutas.js';
import { manejar } from './servidor/router.js';

/**
 * Arranque del puente.
 *
 * No exige ninguna credencial para levantarse: una conexion sin configurar
 * responde 503 con el nombre de la variable que falta, y el resto sigue
 * funcionando. Asi se pueden conectar las fuentes de una en una sin dejar el
 * portal a oscuras mientras tanto.
 */

// El .env es opcional: en el servidor las variables llegan del panel, y en
// desarrollo se copian de .env.example. Si no existe, se sigue con el entorno.
try {
  process.loadEnvFile('.env');
} catch {
  // Sin .env no hay nada que cargar.
}

const config = leerConfiguracion();
const prefijo = process.env['PUENTE_PREFIJO'] ?? '';

// Lo recibido se lee del disco antes de escuchar: si no, el portal vería el
// buzón vacío entre el reinicio y el siguiente envío, que puede ser horas.
const almacen = new AlmacenIngesta(config.directorioIngesta);
const recuperados = await almacen.cargar();

// Las credenciales de buzones capturadas desde Ajustes tambien viven en disco.
const almacenCorreo = new AlmacenCorreo(config.directorioCorreo);
const buzonesGuardados = await almacenCorreo.cargar();

// Y las variables de integraciones (GitHub, Claude, Odoo...) capturadas desde
// Ajustes, que se ponen encima del entorno.
const almacenIntegraciones = new AlmacenIntegraciones(
  config.directorioIntegraciones
);
const integracionesGuardadas = await almacenIntegraciones.cargar();
const configurador = new Configurador(almacenIntegraciones);

// Equipo, dominios y sesiones: listas chicas en JSON, una por archivo.
const datos = abrirDatos(config.directorioDatos);
await Promise.all([
  datos.equipo.cargar(),
  datos.dominios.cargar(),
  datos.sesiones.cargar()
]);

const servidor = createServer(
  manejar(
    construirRutas(
      config,
      new Cache(),
      almacen,
      almacenCorreo,
      { almacen: almacenIntegraciones, configurador },
      datos
    ),
    {
      origenesPermitidos: config.origenesPermitidos,
      prefijo,
      maximoCuerpoBytes: config.maximoCuerpoBytes
    }
  )
);

servidor.listen(config.puerto, () => {
  const conexiones = estadoDeConexiones(configurador.config(), almacenCorreo);
  console.log(
    configurador.config().acceso
      ? `[puente] acceso con código por correo para: ${configurador.config().acceso?.correos.join(', ')}`
      : '[puente] acceso abierto: sin EmailJS y ACCESO_CORREOS no se pide código'
  );
  if (integracionesGuardadas > 0) {
    console.log(
      `[puente] ${integracionesGuardadas} integraciones con variables guardadas desde Ajustes`
    );
  }
  const listas = conexiones.filter((estado) => estado.configurada);
  console.log(`[puente] escuchando en :${config.puerto}${prefijo || ''}`);
  if (config.clientesIngesta.length > 0) {
    console.log(
      `[puente] ${config.clientesIngesta.length} emisores autorizados: ` +
        config.clientesIngesta.map((cliente) => cliente.nombre).join(', ') +
        ` · ${recuperados} envíos recuperados del disco`
    );
  }
  console.log(
    `[puente] ${listas.length} de ${conexiones.length} conexiones configuradas` +
      (listas.length > 0
        ? `: ${listas.map((estado) => estado.conexion).join(', ')}`
        : '')
  );
  for (const estado of conexiones.filter((fila) => !fila.configurada)) {
    console.log(
      `[puente]   · ${estado.conexion} apagada, falta ${estado.faltante}`
    );
  }
  if (config.correos.length > 0 || buzonesGuardados > 0) {
    console.log(
      `[puente] buzones: ${config.correos.length} en CORREO_CUENTAS, ${buzonesGuardados} guardados desde Ajustes` +
        (config.adminToken
          ? ''
          : ' · sin PUENTE_ADMIN_TOKEN no se pueden editar desde el portal')
    );
  }
});

// Sin esto un reinicio deja conexiones a medias y el orquestador espera el
// tiempo completo de gracia en cada despliegue.
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    console.log(`[puente] ${senal}, cerrando`);
    servidor.close(() => process.exit(0));
  });
}
