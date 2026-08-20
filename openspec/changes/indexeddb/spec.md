# Spec: IndexedDB para Finanzas Personales 2026

## Context
La app actual usa localStorage para persistir datos. localStorage tiene un límite de ~5MB y sincroniza todo en memoria, lo que puede causar problemas con muchos registros. IndexedDB es la alternativa nativa del navegador: más capacidad, asíncrona, y soporta índices.

## Requirements

### R1: Wrapper de persistencia
- Crear un módulo `src/storage.js` con API uniforme
- Soportar operaciones: `load()`, `save(entries)`, `clear()`
- Internamente usar IndexedDB con fallback a localStorage si IndexedDB no está disponible

### R2: Migración automática
- Al cargar la app, detectar si hay datos en localStorage y no en IndexedDB
- Migrar automáticamente de localStorage a IndexedDB
- Después de migrar, limpiar localStorage (dejar solo la key como flag)

### R3: Compatibilidad con app.js
- `loadFromStorage()` y `saveToStorage()` en app.js deben usar el nuevo wrapper
- La interfaz pública no cambia: `entries` sigue siendo un array en memoria
- La sincronización sigue siendo síncrona para el render (cargar todo al inicio, guardar todo en cada cambio)

### R4: Testing
- Tests unitarios para el wrapper de storage
- Tests de migración (localStorage → IndexedDB)
- Mantener los 40 tests existentes pasando

## Out of scope
- No se agrega sincronización entre pestañas (BroadcastChannel)
- No se agrega caché de consultas
- No se cambia la UI
