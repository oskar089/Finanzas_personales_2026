# Design: IndexedDB para Finanzas Personales 2026

## Architecture

### Nuevo módulo: `src/storage.js`

```
┌─────────────────────────────────────────┐
│  app.js (consume)                       │
│  loadFromStorage() → storage.load()     │
│  saveToStorage()   → storage.save()     │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  src/storage.js (wrapper)               │
│                                         │
│  storage.load()  → Promise<Entry[]>     │
│  storage.save(entries) → Promise<void>  │
│  storage.clear() → Promise<void>        │
│                                         │
│  Internamente:                          │
│  1. Intenta IndexedDB                   │
│  2. Si no disponible → fallback localStorage │
│  3. Migra de localStorage si hay datos  │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  IndexedDB (db: "finanzas", store: "entries") │
│  - keyPath: "id"                        │
│  - Índice por "fecha" para ordenamiento │
└─────────────────────────────────────────┘
```

### API

```js
// src/storage.js
const DB_NAME = 'finanzas_personales_2026';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const LS_KEY = 'finanzas:gastos:v1';

export async function load() {
    // 1. Intentar IndexedDB
    // 2. Fallback a localStorage
    // 3. Migrar si hay datos en LS pero no en IDB
}

export async function save(entries) {
    // Guardar todo el array en IndexedDB
    // Fallback a localStorage si IDB no disponible
}

export async function clear() {
    // Limpiar IndexedDB
    // Limpiar localStorage
}
```

### Migración

```js
async function migrateFromLS() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    if (entries.length > 0) {
        await save(entries);
    }
    // Flag de migración
    localStorage.setItem('finanzas:migrated', 'true');
    localStorage.removeItem(LS_KEY);
}
```

### Fallback

```js
function isIDBAvailable() {
    try {
        return typeof indexedDB !== 'undefined';
    } catch {
        return false;
    }
}
```

## Files to create/modify
- **Create**: `src/storage.js`
- **Modify**: `app.js` (cambiar loadFromStorage/saveToStorage)
- **Create**: `src/storage.test.js`

## Testing strategy
- Tests unitarios con `fake-indexeddb` para simular IDB en jsdom
- Tests de migración (LS → IDB)
- Tests de fallback (IDB no disponible → LS)
- Verificar que los 40 tests existentes siguen pasando

## Risks
- `fake-indexeddb` es una dependencia nueva (devDependency)
- La app sincroniza en memoria (cargar todo al inicio) — OK para cantidades normales
