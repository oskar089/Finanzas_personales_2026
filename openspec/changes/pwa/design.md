# Design: PWA + Service Worker

## Architecture

```
index.html
  ├── <link rel="manifest" href="manifest.json">
  └── <script> — register SW

manifest.json — metadata de la app
sw.js — service worker (cache de assets)

App instalable en Android/Chrome/iOS (limitado)
```

## Files
- **Create**: `manifest.json`, `sw.js`
- **Modify**: `index.html` (link manifest + SW registration)

## Cache strategy
- Cache-first para assets locales (HTML, CSS, JS)
- Cache-first para CDN (Bootstrap, Chart.js) — ya tienen SRI
- Sin network fallback — es offline-first

## Icons
- Usar emoji como icono temporal (no requiere archivos de imagen)
- `icons` en manifest con SVG data URI
