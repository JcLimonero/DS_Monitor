import { createServer } from 'node:http';
import { leerConfiguracion } from './config/entorno.js';
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
const servidor = createServer(
  manejar(construirRutas(config, new Cache()), {
    origenesPermitidos: config.origenesPermitidos,
    prefijo
  })
);

servidor.listen(config.puerto, () => {
  const conexiones = estadoDeConexiones(config);
  const listas = conexiones.filter((estado) => estado.configurada);
  console.log(`[puente] escuchando en :${config.puerto}${prefijo || ''}`);
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
