/*
 * Service worker de DS Monitor: solo avisos push.
 *
 * El puente manda el push sin cuerpo; aquí se despierta, se piden al puente
 * los avisos en cola de este dispositivo (identificado por su endpoint, que
 * solo este navegador conoce) y se enseñan. No cachea la aplicación: el
 * portal se sirve siempre fresco desde Vercel.
 */
// La raíz del puente llega en la URL de registro (?api=…); por omisión, el
// rewrite de Vercel.
const API =
  new URL(self.location.href).searchParams.get('api') || '/api/portal';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (evento) => {
  evento.waitUntil(
    (async () => {
      const sub = await self.registration.pushManager.getSubscription();
      if (!sub) {
        return;
      }
      let avisos = [];
      try {
        const r = await fetch(`${API}/push/pendientes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
        avisos = r.ok ? await r.json() : [];
      } catch (_) {
        avisos = [];
      }
      if (!Array.isArray(avisos) || avisos.length === 0) {
        // Algo llegó pero no hay nada en cola: se avisa genérico para no
        // perder el permiso (los navegadores lo exigen).
        avisos = [{ titulo: 'DS Monitor', cuerpo: 'Hay novedades en el tablero.', url: '/hoy' }];
      }
      for (const a of avisos) {
        await self.registration.showNotification(a.titulo || 'DS Monitor', {
          body: a.cuerpo || '',
          icon: '/iconos/icono-192.png',
          badge: '/iconos/icono-192.png',
          tag: a.etiqueta || undefined,
          data: { url: a.url || '/hoy' }
        });
      }
    })()
  );
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const url = (evento.notification.data && evento.notification.data.url) || '/hoy';
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const v of ventanas) {
        if ('focus' in v) {
          await v.focus();
          if ('navigate' in v) {
            await v.navigate(url);
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

// Si el navegador renueva la suscripción, se vuelve a registrar en el puente.
self.addEventListener('pushsubscriptionchange', (evento) => {
  evento.waitUntil(
    (async () => {
      const nueva = evento.newSubscription || (await self.registration.pushManager.getSubscription());
      if (nueva) {
        await fetch(`${API}/push/suscribir`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: nueva.endpoint })
        }).catch(() => undefined);
      }
    })()
  );
});
