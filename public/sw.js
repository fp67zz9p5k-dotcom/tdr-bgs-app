const CACHE_PREFIX = 'tdr-archive-'
const CACHE_NAME = `${CACHE_PREFIX}v67-ios-dom-heading-surface`
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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map(async (url) => {
        const response = await fetch(url, { cache: 'reload' })
        if (response.ok) await cache.put(url, response)
      })),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  if (new URL(event.request.url).hostname.endsWith('openfreemap.org')) return
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(OFFLINE_PAGE, copy))
          }
          return response
        })
        .catch(() => caches.match(OFFLINE_PAGE)),
    )
    return
  }

  const requestUrl = new URL(event.request.url)
  const isSameOrigin = requestUrl.origin === self.location.origin
  const isHashedAsset = isSameOrigin && requestUrl.pathname.includes('/assets/')

  if (isSameOrigin && !isHashedAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => caches.match(event.request)),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ?? fetch(event.request, { cache: isHashedAsset ? 'no-store' : 'default' }).then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        return response
      }),
    ),
  )
})
