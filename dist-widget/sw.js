// Service Worker for EVENTS PWA
// Network-first strategy for HTML/JS — ensures deploys are always fresh
const CACHE_NAME = 'events-admin-20260304v2';

// Assets to cache on install (app shell)
const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/index.css',
];

// Install: cache app shell
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: network-first for HTML/JS, cache-first for images/fonts
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API calls: always go to network (admin needs fresh data)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // HTML and JS files: NETWORK-FIRST (ensures deploys are reflected immediately)
    if (request.destination === 'document' || request.destination === 'script' ||
        url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname === '/') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok && request.method === 'GET') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request)) // Fallback to cache if offline
        );
        return;
    }

    // Static assets (images, fonts, CSS): cache-first with network fallback
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                if (response.ok && request.method === 'GET') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                }
                return response;
            });
        })
    );
});
