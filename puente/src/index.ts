import { createServer } from 'node:http';
import { leerConfiguracion } from './config/entorno.js';
import { AlmacenIngesta } from './ingesta/almacen.js';
import { Cache } from './nucleo/cache.js';
import { construirRutas, estadoDeConexiones } from './servidor/rutas.js';
import { manejar } from './servidor/router.js';

/**
 * Arranque del puente.
 *
 * No exige ninguna credencial para levantarse: una conexion sin configurar
 * responde 503 con el nombre de la variable que falta, y el resto sigue
 * funcionando. Asi se pueden conectar las fuentes de una en una sin dejar el
 * portal a oscuras mientras tanto.
 */

const config = leerConfiguracion();
const prefijo = process.env['PUENTE_PREFIJO'] ?? '';

// Lo recibido se lee del disco antes de escuchar: si no, el portal vería el
// buzón vacío entre el reinicio y el siguiente envío, que puede ser horas.
const almacen = new AlmacenIngesta(config.directorioIngesta);
const recuperados = await almacen.cargar();

const servidor = createServer(
  manejar(construirRutas(config, new Cache(), almacen), {
    origenesPermitidos: config.origenesPermitidos,
    prefijo,
    maximoCuerpoBytes: config.maximoCuerpoBytes
  })
);

servidor.listen(config.puerto, () => {
  const conexiones = estadoDeConexiones(config);
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
});

// Sin esto un reinicio deja conexiones a medias y el orquestador espera el
// tiempo completo de gracia en cada despliegue.
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    console.log(`[puente] ${senal}, cerrando`);
    servidor.close(() => process.exit(0));
  });
}
