// Loaded by the app's service worker (see vite.config.js). Shows the phone notification
// when a vendor submits a permit application, and opens the permits page when tapped.
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('New vendor work permit', {
    body: 'A vendor submitted a permit application. Tap to open.',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: 'vendor-permit',
    renotify: true,
    data: { url: '/permits' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/permits'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { if ('navigate' in c) c.navigate(url); return c.focus() }
    }
    return self.clients.openWindow(url)
  }))
})
