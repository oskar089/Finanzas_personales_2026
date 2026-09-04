// =====================================================================
// Service Worker — Finanzas Personales 2026
// =====================================================================
// Network-first para archivos locales (siempre sirve la versión más nueva).
// Cache-first para CDN (no cambian y tienen SRI).
// =====================================================================

const CACHE_NAME = 'finanzas-v6';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/src/finance.js',
    '/src/crypto.js',
    '/src/boot.js',
    '/src/storage.js',
    '/src/cloud-sync.js',
    '/vendor/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'
];

// --- Instalación: pre-cache de assets -------------------------------

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// --- Activación: limpiar caches viejos ------------------------------

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => {
            // Avisar a todas las pestañas que hay una nueva versión
            self.clients.matchAll().then(clients => {
                clients.forEach(client => client.postMessage({ type: 'SW_UPDATED' }));
            });
            return self.clients.claim();
        })
    );
});

// --- Fetch: network-first local, cache-first CDN --------------------

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Ollama API: siempre ir a la red (nunca cachear respuestas de IA)
    if (url.hostname === 'localhost' && url.port === '11434') {
        return;
    }

    // CDN assets (Bootstrap, Chart.js): cache-first
    // Note: only these have SRI integrity hashes in the script tag
    if (url.origin !== location.origin) {
        event.respondWith(
            caches.match(event.request)
                .then(cached => cached || fetch(event.request))
        );
        return;
    }

    // Local assets: network-first (fallback a cache si offline)
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Actualizar cache con la versión más nueva
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, clone);
                });
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
