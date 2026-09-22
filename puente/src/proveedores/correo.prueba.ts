import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  candidatosParaIa,
  detectarLicencias,
  esCorreoDeTotalOne,
  detectarLicenciasConEvidencia,
  detectarPendientes,
  montoDelRecibo,
  nombreDelRemitente
} from './correo.js';
import type { EncabezadoCorreo } from './imap.js';

const AHORA = new Date('2026-09-16T12:00:00Z');

let uid = 0;
const correo = (
  remitente: string,
  asunto: string,
  fecha: string,
  tipoContenido = 'text/html'
): EncabezadoCorreo => ({
  uid: ++uid,
  fecha: new Date(fecha).toISOString(),
  remitente,
  asunto,
  tipoContenido
});

describe('licencias deducidas del correo', () => {
  it('reconoce a un proveedor conocido y separa sus productos', () => {
    const licencias = detectarLicencias(
      [
        correo(
          'Microsoft <microsoft-noreply@microsoft.com>',
          'You’ve renewed your Microsoft 365 Business Basic subscription',
          '2026-09-01'
        ),
        correo(
          'Microsoft <microsoft-noreply@microsoft.com>',
          'You’ve renewed your Exchange Online Kiosk subscription',
          '2026-09-08'
        ),
        correo(
          'Microsoft <microsoft-noreply@microsoft.com>',
          'You’ve renewed your Exchange Online Kiosk subscription',
          '2026-08-08'
        )
      ],
      'correo-nexus',
      AHORA
    );
    assert.deepEqual(
      licencias.map((l) => l.product),
      [
        'Microsoft 365 · Exchange Online Kiosk',
        'Microsoft 365 · Microsoft 365 Business Basic'
      ]
    );
    const kiosk = licencias[0]!;
    assert.equal(kiosk.plan, 'Mensual · 2 recibos en el correo');
    assert.equal(kiosk.periodStart, '2026-09-08T00:00:00.000Z');
    assert.equal(kiosk.renewsAt, '2026-10-09T00:00:00.000Z');
    assert.equal(kiosk.manual, false);
    assert.equal(kiosk.provider, 'otro');
    assert.equal(kiosk.accountId, 'correo-nexus');
  });

  it('marca el proveedor cuando el portal ya lo conoce', () => {
    const [claude] = detectarLicencias(
      [
        correo(
          'Anthropic <receipts@mail.anthropic.com>',
          'Your receipt from Anthropic, PBC #2320-0465-4720',
          '2026-09-16'
        )
      ],
      'correo-gmail',
      AHORA
    );
    assert.equal(claude?.provider, 'anthropic');
    assert.equal(claude?.product, 'Claude');
  });

  it('una suscripción que lleva meses sin recibo ya no está vigente', () => {
    const licencias = detectarLicencias(
      [
        correo(
          'Stripe <receipts@stripe.com>',
          'Your receipt from Gamma #2369-2930',
          '2026-02-12'
        ),
        correo(
          'Stripe <receipts@stripe.com>',
          'Your receipt from Render Services #1',
          '2026-08-04'
        )
      ],
      'correo-outlook',
      AHORA
    );
    assert.deepEqual(
      licencias.map((l) => l.product),
      ['Render']
    );
  });

  it('las anuales aguantan más tiempo sin recibo', () => {
    const [apple] = detectarLicencias(
      [
        correo(
          'Apple Developer <developer@email.apple.com>',
          'Your Membership has been Renewed.',
          '2025-07-14'
        )
      ],
      'correo-vanguardia',
      AHORA
    );
    assert.equal(apple?.product, 'Apple Developer Program');
    // El ciclo de 2025 ya paso: la renovacion que se muestra es la de 2026.
    assert.equal(apple?.renewsAt, '2027-07-16T00:00:00.000Z');
  });

  it('lo que suena a suscripción pero no es de un proveedor conocido usa el nombre del remitente', () => {
    const [yoga] = detectarLicencias(
      [
        correo(
          'Yoga-Go <hola@email.yoga-go.io>',
          'Tu suscripción a Yoga-Go se ha renovado',
          '2026-09-04'
        )
      ],
      'correo-gmail',
      AHORA
    );
    assert.equal(yoga?.product, 'Yoga-Go');
  });

  it('la publicidad que usa las mismas palabras se descarta', () => {
    const licencias = detectarLicencias(
      [
        correo(
          'Zoom <no-reply@zoom.us>',
          'Oferta por tiempo limitado: 15 % de descuento en la suscripción a Zoom Workplace Pro anual',
          '2026-06-25'
        ),
        correo(
          'Zoom <no-reply@zoom.us>',
          'Payment Processed for 7038913102',
          '2026-08-25'
        )
      ],
      'correo-dealer',
      AHORA
    );
    assert.equal(licencias.length, 1);
    assert.equal(licencias[0]?.product, 'Zoom');
  });

  it('un encabezado sin fecha no cuenta', () => {
    const sinFecha: EncabezadoCorreo = {
      uid: 1,
      fecha: '',
      remitente: 'Zoom <no-reply@zoom.us>',
      asunto: 'Payment Processed for 1',
      tipoContenido: 'text/html'
    };
    assert.deepEqual(detectarLicencias([sinFecha], 'x', AHORA), []);
  });
});

describe('pendientes deducidos del correo', () => {
  it('un cobro rechazado es urgente y vence en dos días', () => {
    const [pendiente] = detectarPendientes(
      [
        correo(
          'SendGrid <billing@sendgrid.com>',
          'Action needed - Your payment to SendGrid has failed (P-20075298)',
          '2026-09-10T15:00:00Z'
        )
      ],
      'correo-vanguardia',
      AHORA
    );
    assert.equal(pendiente?.priority, 'urgente');
    assert.equal(pendiente?.dueDate, '2026-09-12T15:00:00.000Z');
    assert.equal(pendiente?.origin, 'correo');
    assert.deepEqual(pendiente?.tags, ['correo', 'pago']);
    assert.match(
      pendiente?.description ?? '',
      /^De: SendGrid <billing@sendgrid\.com>\nAsunto: Action needed/
    );
  });

  it('un dominio por renovar es de prioridad media con una semana', () => {
    const [pendiente] = detectarPendientes(
      [
        correo(
          'Neubox <no-reply@neubox.net>',
          'La renovación de uno o más Dominios está próxima. ¡Renueva HOY!',
          '2026-09-15T10:00:00Z'
        )
      ],
      'correo-gmail',
      AHORA
    );
    assert.equal(pendiente?.priority, 'media');
    assert.equal(pendiente?.dueDate, '2026-09-22T10:00:00.000Z');
  });

  it('el mismo aviso repetido queda una sola vez, con la fecha más reciente', () => {
    const pendientes = detectarPendientes(
      [
        correo(
          'EmailJS (via Paddle.com) <help@paddle.com>',
          'Se requiere una acción para mantener su suscripción Personal Plan / Monthly',
          '2026-08-25'
        ),
        correo(
          'EmailJS (via Paddle.com) <help@paddle.com>',
          'Se requiere una acción para mantener su suscripción Personal Plan / Monthly',
          '2026-09-01'
        )
      ],
      'correo-nexus',
      AHORA
    );
    assert.equal(pendientes.length, 1);
    assert.equal(pendientes[0]?.updatedAt, '2026-09-01T00:00:00.000Z');
  });

  it('lo de hace más de treinta días ya no es pendiente', () => {
    const pendientes = detectarPendientes(
      [
        correo(
          'X <x@x.com>',
          'Action required: update your payment',
          '2026-07-01'
        )
      ],
      'correo-outlook',
      AHORA
    );
    assert.deepEqual(pendientes, []);
  });

  it('un correo normal no genera pendiente', () => {
    const pendientes = detectarPendientes(
      [
        correo(
          'Ana <ana@ejemplo.com>',
          'Minuta de la junta de hoy',
          '2026-09-15'
        )
      ],
      'correo-outlook',
      AHORA
    );
    assert.deepEqual(pendientes, []);
  });
});

describe('nombreDelRemitente', () => {
  it('prefiere el nombre y cae al dominio', () => {
    assert.equal(nombreDelRemitente('Zoom <no-reply@zoom.us>'), 'Zoom');
    assert.equal(
      nombreDelRemitente('"Apple Developer" <dev@email.apple.com>'),
      'Apple Developer'
    );
    assert.equal(nombreDelRemitente('no-reply@zoom.us'), 'zoom.us');
  });
});

describe('montoDelRecibo', () => {
  it('prefiere la cantidad que sigue a "total"', () => {
    assert.deepEqual(
      montoDelRecibo(
        'Subtotal $128.45 Impuestos $20.55 Total $149.00',
        'Apple <no_reply@email.apple.com>'
      ),
      { costo: 149, moneda: 'USD' }
    );
  });

  it('sin "total" toma la mayor, que suele ser el total', () => {
    assert.deepEqual(
      montoDelRecibo(
        'Dominio $219.00 MXN IVA $35.04 MXN Pagaste $254.04 MXN',
        'NEUBOX <ventas@neubox.net>'
      ),
      { costo: 254.04, moneda: 'MXN' }
    );
  });

  it('lee miles con coma y monedas con prefijo o sufijo', () => {
    assert.deepEqual(
      montoDelRecibo('Amount due: $1,572.17', 'AWS <invoicing@aws.com>'),
      { costo: 1572.17, moneda: 'USD' }
    );
    assert.deepEqual(
      montoDelRecibo('Cobro de 23.20 USD', 'Figma <x@figma.com>'),
      { costo: 23.2, moneda: 'USD' }
    );
    assert.deepEqual(
      montoDelRecibo('Total MXN403.46', 'GoDaddy <x@godaddy.com>'),
      { costo: 403.46, moneda: 'MXN' }
    );
  });

  it('un $ a secas es MXN cuando el remitente es .mx', () => {
    assert.deepEqual(
      montoDelRecibo(
        'Recarga exitosa por $399.00',
        'Pillofon <no-reply@pillofon.mx>'
      ),
      { costo: 399, moneda: 'MXN' }
    );
  });

  it('sin cantidades no inventa nada', () => {
    assert.equal(
      montoDelRecibo('Gracias por tu pago', 'x <x@x.com>'),
      undefined
    );
  });
});

describe('detectarLicenciasConEvidencia', () => {
  it('señala el correo más reciente de cada licencia', () => {
    const [zoom] = detectarLicenciasConEvidencia(
      [
        correo(
          'Zoom <billing@zoom.us>',
          'Payment Processed for 1',
          '2026-07-25'
        ),
        correo(
          'Zoom <billing@zoom.us>',
          'Payment Processed for 1',
          '2026-08-25'
        ),
        correo(
          'Zoom <billing@zoom.us>',
          'Payment Processed for 1',
          '2026-06-25'
        )
      ],
      'correo-dealer',
      AHORA
    );
    assert.equal(zoom?.ultimo.fecha, '2026-08-25T00:00:00.000Z');
    assert.equal(zoom?.licencia.renewsAt, '2026-09-25T00:00:00.000Z');
  });
});

describe('candidatosParaIa', () => {
  const opciones = { dias: 7, maximo: 10, yaAnalizado: () => false };

  it('deja fuera lo que manda el propio monitor', () => {
    const encabezados = [
      correo(
        'DS Monitor <hola@totalone.mx>',
        'Access Monitor',
        '2026-09-16T10:00:00Z'
      ),
      correo(
        'DS Monitor <hola@totalone.mx>',
        'RE: Access Monitor',
        '2026-09-16T10:30:00Z'
      ),
      correo(
        'Ken <ken@cliente.com>',
        'Formulario de Javier',
        '2026-09-16T11:00:00Z'
      )
    ];
    const candidatos = candidatosParaIa(
      encabezados,
      new Set(),
      'correo-nexus',
      opciones,
      AHORA
    );
    assert.deepEqual(
      candidatos.map((c) => c.encabezado.asunto),
      ['Formulario de Javier']
    );
  });

  it('deja fuera los avisos ARIA de consulta agendada', () => {
    const candidatos = candidatosParaIa(
      [
        correo(
          'ARIA — Plataforma central de iTechDev <avisos@meet.itechdev.com.mx>',
          'Nueva consulta agendada: Fernanda López · jue 24 sep · 12:15 p.m.',
          '2026-09-16T17:20:00Z'
        ),
        correo('Ken <ken@cliente.com>', 'Propuesta', '2026-09-16T11:00:00Z')
      ],
      new Set(),
      'correo-itech',
      opciones,
      AHORA
    );
    assert.deepEqual(
      candidatos.map((c) => c.encabezado.asunto),
      ['Propuesta']
    );
  });
});

describe('esCorreoDeTotalOne', () => {
  it('reconoce el asunto del buzon de pruebas y el pie de la plantilla', () => {
    assert.ok(
      esCorreoDeTotalOne(
        '[PRUEBA · para admin@demo.local] Quieren apartar: Toyota Corolla 2024'
      )
    );
    assert.ok(
      esCorreoDeTotalOne(
        'RE: [PRUEBA · para admin@demo.local] Nuevo lead',
        'Cualquier cosa'
      )
    );
    assert.ok(
      esCorreoDeTotalOne(
        'Quieren apartar: Mazda 3 2023',
        'Comprador Juan · desde el marketplace.\nEste correo te lo envía Demo.\nEnviado con Total One · 2026'
      )
    );
    assert.ok(
      esCorreoDeTotalOne(
        'Nueva cuenta: Taller Limon',
        'Aviso automático de Total One · Total Dealer · 2026'
      )
    );
  });

  it('reconoce un pendiente ya registrado por el "Asunto:" de su descripcion', () => {
    assert.ok(
      esCorreoDeTotalOne(
        'Llamar a comprador para apartado Toyota Corolla 2024',
        'El comprador quiere apartar.\n\nDe: Carlos <c@x.mx>\nAsunto: [PRUEBA · para admin@demo.local] Quieren apartar: Toyota Corolla 2024\n\nQuieren apartar'
      )
    );
  });

  it('deja pasar el correo normal, aunque mencione Total One', () => {
    assert.equal(
      esCorreoDeTotalOne(
        'Cotización de Total One para Grupo Andrade',
        'Hola Carlos, ¿nos mandas la propuesta de Total One esta semana?'
      ),
      false
    );
    assert.equal(esCorreoDeTotalOne('Access Monitor'), false);
  });

  it('candidatosParaIa lo deja fuera por el asunto', () => {
    const lista = candidatosParaIa(
      [
        correo(
          'Carlos Limon <carlos.limon@nexusqtech.com>',
          '[PRUEBA · para admin@demo.local] Quieren apartar: Nissan Versa 2023',
          '2026-09-16T10:00:00Z'
        ),
        correo('Ken <ken@cliente.com>', 'Propuesta', '2026-09-16T11:00:00Z')
      ],
      new Set(),
      'correo-itech',
      { dias: 7, maximo: 10, yaAnalizado: () => false },
      new Date('2026-09-17T00:00:00Z')
    );
    assert.deepEqual(
      lista.map((c) => c.encabezado.asunto),
      ['Propuesta']
    );
  });
});
