# Spec: PWA + Service Worker para Finanzas Personales 2026

## Context
La app funciona solo online. Con PWA puede instalarse en el celular y funcionar offline.

## Requirements

### R1: manifest.json
- Nombre, ícono, colores, display: standalone
- Scope: /

### R2: Service Worker
- Cache de archivos estáticos (HTML, CSS, JS, CDN)
- Estrategia: cache-first para assets, network-first para nada (es offline)
- Actualización automática del SW

### R3: Registro del SW
- En index.html o app.js, registrar el service worker
- Mostrar prompt de instalación (beforeinstallprompt)

### R4: Testing
- Verificar que manifest.json es válido
- Verificar que el SW se registra
- No romper los 50 tests existentes
