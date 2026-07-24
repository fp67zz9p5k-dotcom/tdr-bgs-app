const CACHE_NAME = 'tdr-archive-v54'
const scopeUrl = self.registration.scope
const appUrl = (path) => new URL(path, scopeUrl).toString()
const APP_SHELL = [
  appUrl('./'),
  appUrl('index.html'),
  appUrl('manifest.webmanifest'),
  appUrl('icon-192.png'),
  appUrl('icon-512.png'),
  appUrl('apple-touch-icon.png'),
  appUrl('favicon-32.png'),
]
const OFFLINE_PAGE = appUrl('index.html')

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (new URL(event.request.url).hostname.endsWith('openfreemap.org')) return
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(OFFLINE_PAGE, copy))
          return response
        })
        .catch(() => caches.match(OFFLINE_PAGE)),
    )
    return
  }
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ?? fetch(event.request).then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        return response
      }),
    ),
  )
})
