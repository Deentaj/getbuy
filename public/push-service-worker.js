self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const title = typeof payload.title === 'string' ? payload.title : 'GetBuy';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : 'You have a new GetBuy alert.',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'open-notifications' });
        return;
      }
    }
    await self.clients.openWindow('/?openNotifications=1');
  })());
});
