/**
 * Donde se permite usar el modelo. Cada uso se prende o apaga desde
 * Integraciones → IA; lo apagado no gasta ni un token: las rutas que
 * dependen de el responden que esta apagado, y lo automatico se salta.
 */
export const USOS_IA = [
  'correo',
  'juntas',
  'dictado',
  'audio',
  'respuestas',
  'resumen',
  'repos',
  'diagnosticos',
  'pendientes',
  'semana'
] as const;

export type UsoIa = (typeof USOS_IA)[number];

export type UsosIa = Record<UsoIa, boolean>;

export const USOS_POR_OMISION: UsosIa = {
  correo: true,
  juntas: true,
  dictado: true,
  audio: true,
  respuestas: true,
  resumen: false,
  repos: false,
  diagnosticos: false,
  pendientes: false,
  semana: false
};

export const ETIQUETA_USO: Record<UsoIa, { titulo: string; detalle: string }> =
  {
    correo: {
      titulo: 'Correo',
      detalle:
        'Clasifica los correos que las reglas no reconocen: pendiente sí/no, empresa, prioridad, fecha y sugerencias para el CRM.'
    },
    juntas: {
      titulo: 'Juntas (Fireflies)',
      detalle:
        'Afina los acuerdos de cada junta transcrita y el botón Acuerdos (IA) en Agenda.'
    },
    dictado: {
      titulo: 'Dictado',
      detalle:
        'Entiende lo que dictas en Dictar y por Telegram (sin IA quedan las reglas).'
    },
    audio: {
      titulo: 'Notas de voz de Telegram',
      detalle: 'Transcribe los audios que llegan al bot.'
    },
    respuestas: {
      titulo: 'Redactar respuestas',
      detalle:
        'Borradores de contestación a correos, desde el pendiente o desde Dictar → Responder.'
    },
    resumen: {
      titulo: 'Resumen del día',
      detalle: 'Desde el botón ✦ Ayuda.'
    },
    repos: {
      titulo: 'Semana en los repositorios',
      detalle: 'Desde el botón ✦ Ayuda.'
    },
    diagnosticos: {
      titulo: 'Diagnóstico de caídas',
      detalle: 'Desde el botón ✦ Ayuda o Monitoreo.'
    },
    pendientes: {
      titulo: 'Empresa y prioridad de pendientes de Ops',
      detalle: 'Clasifica solo lo que llega por la API sin empresa.'
    },
    semana: {
      titulo: 'Apertura del correo del lunes',
      detalle: 'Un párrafo por persona en el resumen semanal.'
    }
  };

export function limpiarUsos(crudo: unknown, base: UsosIa): UsosIa {
  const u = (crudo ?? {}) as Record<string, unknown>;
  const salida = { ...base };
  for (const uso of USOS_IA) {
    if (typeof u[uso] === 'boolean') {
      salida[uso] = u[uso] as boolean;
    }
  }
  return salida;
}
