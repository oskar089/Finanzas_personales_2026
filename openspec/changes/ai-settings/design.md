# Design: Multi-Provider AI Settings

## Technical Approach

Replace hardcoded Ollama constants (`app.js:15-16`) with a provider adapter layer that normalizes all AI backends to OpenAI chat format. A settings modal lets users configure provider, base URL, API key, and model. Settings persist in IndexedDB (new store, DB v5) with localStorage fallback. `autoCategorize()` and `renderRecommendations()` switch from raw `fetch(OLLAMA_URL, ...)` to `chatCompletion(messages)` via the active adapter.

## Architecture

```
┌──────────────────────────────────────────────┐
│  app.js                                      │
│  autoCategorize()                            │
│  renderRecommendations()                     │
│  → calls chatCompletion(messages)            │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  src/ai-providers.js                         │
│                                              │
│  getActiveProvider() → adapter               │
│  chatCompletion(messages, opts) → response   │
│  discoverModels() → string[]                 │
│  testConnection() → { ok, error? }           │
│                                              │
│  Adapters:                                   │
│  - LocalAdapter  → /v1/chat/completions      │
│  - OpenAIAdapter → /v1/chat/completions      │
│  - GeminiAdapter → /v1beta/models:generate   │
│  - ClaudeAdapter → /v1/messages              │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  src/storage.js                              │
│  loadAiSettings() / saveAiSettings()         │
│  → IndexedDB aiSettings store (DB v5)        │
│  → localStorage fallback                     │
└──────────────────────────────────────────────┘
```

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Adapter pattern | Per-provider class vs config-driven function map | Class: extensible but heavier. Function map: simpler, fits 4 providers. | **Config-driven map** — only 4 providers, no inheritance needed |
| Ollama endpoint | Keep `/api/generate` vs switch to `/v1/chat/completions` | `/api/generate`: no change but non-standard. `/v1/chat/completions`: unified format, requires Ollama ≥0.4. | **Switch to `/v1/chat/completions`** — unified format, Ollama ≥0.4 is standard now |
| Settings shape | Object per provider vs single active record | Per-provider: stores all configs. Single record: simpler, user only needs one active. | **Single active record** — user configures one provider at a time |
| DB key for aiSettings | Auto-increment vs fixed `'active'` key | Auto-increment: standard pattern. Fixed key: simpler for single-record store. | **Fixed `'active'` key** — exactly one settings record |

## Data Model

### IndexedDB `aiSettings` store (DB v5)

```
keyPath: 'id'

Record:
{
  id:        'active',           // fixed key — single record
  provider:  'local' | 'openai' | 'gemini' | 'claude',
  baseUrl:   string,             // e.g. 'http://localhost:11434'
  apiKey:    string,             // empty for local provider
  model:     string,             // e.g. 'gemma3:4b', 'gpt-4o'
  updatedAt: number              // Date.now() timestamp
}
```

### localStorage fallback key
`finanzas:ai-settings:v1` — same JSON shape, single object.

### Default settings (no record exists)
```js
{ provider: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'gemma3:4b' }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/ai-providers.js` | **Create** | Provider adapters, `chatCompletion()`, `discoverModels()`, `testConnection()`, `getActiveProvider()` |
| `src/storage.js` | **Modify** | DB_VERSION 4→5, add `AI_SETTINGS_STORE`, add `loadAiSettings()`/`saveAiSettings()`, add LS helpers |
| `app.js` | **Modify** | Remove `OLLAMA_URL`/`OLLAMA_MODEL` constants, add `loadAiSettings()` at init, replace raw fetch in `autoCategorize()` and `renderRecommendations()` with `chatCompletion()`, add settings modal event wiring |
| `index.html` | **Modify** | Add ⚙️ IA navbar button, add `#aiSettingsModal` Bootstrap modal, add `<script src="src/ai-providers.js">` |

## Key Functions — Pseudocode

### `src/ai-providers.js`

```js
// --- Provider config map ---
const PROVIDERS = {
  local:  { name: 'Local (OpenAI-compatible)', baseUrl: 'http://localhost:11434', modelsEndpoint: '/v1/models', chatEndpoint: '/v1/chat/completions' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com', modelsEndpoint: '/v1/models', chatEndpoint: '/v1/chat/completions' },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', chatEndpoint: null },  // custom format
  claude: { name: 'Claude', baseUrl: 'https://api.anthropic.com', chatEndpoint: '/v1/messages' }               // custom format
};

async function getActiveProvider() {
  const settings = await storage.loadAiSettings();  // null if no record
  return settings || { provider: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'gemma3:4b' };
}

async function chatCompletion(messages, { temperature = 0.3, max_tokens = 500 } = {}) {
  const settings = await getActiveProvider();
  // Dispatch to provider-specific fetch logic
  switch (settings.provider) {
    case 'local':
    case 'openai': return openaiCompatibleFetch(settings, messages, { temperature, max_tokens });
    case 'gemini': return geminiFetch(settings, messages, { temperature, max_tokens });
    case 'claude': return claudeFetch(settings, messages, { temperature, max_tokens });
  }
}

// Returns { ok: boolean, error?: string }
async function testConnection() { ... }

// GET /v1/models — returns string[] or [] on failure
async function discoverModels() { ... }
```

### `app.js` — refactored AI calls

```js
// Replace autoCategorize() lines 196-208:
async function autoCategorize() {
  // ... validation, UI state ...
  const response = await chatCompletion([
    { role: 'system', content: 'Sos un asistente financiero...' },
    { role: 'user', content: `Clasificá: "${desc}" en: ${categories}` }
  ], { temperature: 0.1, max_tokens: 20 });
  // Response is a normalized wrapper: const text = response.text
}

// Same pattern for renderRecommendations() lines 802-812
```

### `src/storage.js` — DB v5 migration

```js
const DB_VERSION = 5;
const AI_SETTINGS_STORE = 'aiSettings';
const LS_AI_SETTINGS_KEY = 'finanzas:ai-settings:v1';

// In openDB() onupgradeneeded:
if (!db.objectStoreNames.contains(AI_SETTINGS_STORE)) {
  db.createObjectStore(AI_SETTINGS_STORE, { keyPath: 'id' });
}

// Public API:
async function loadAiSettings() { /* IDB → LS fallback, return null if none */ }
async function saveAiSettings(settings) { /* IDB + LS sync */ }
```

## UI Wireframe — Settings Modal

```
┌─────────────────────────────────────────────────────┐
│  ⚙️ Configuración de IA                      [X]   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Proveedor:  [Local (OpenAI-compatible)     ▼]     │
│                                                     │
│  URL base:   [http://localhost:11434      ]         │
│              (hidden for openai/gemini/claude        │
│               — uses default URLs)                   │
│                                                     │
│  API Key:    [••••••••••••••••••••          ]       │
│              (hidden/shown toggle, hidden for local) │
│                                                     │
│  Modelo:     [gemma3:4b                   ] [🔍]   │
│              (🔍 triggers discoverModels for local)  │
│                                                     │
│  [Probar conexión]  ✓ Conectado / ✗ Error: ...     │
│                                                     │
├─────────────────────────────────────────────────────┤
│  [Cancelar]                    [Guardar]            │
└─────────────────────────────────────────────────────┘
```

- Navbar button: `⚙️ IA` next to dark mode toggle, follows existing button pattern
- Modal: `id="aiSettingsModal"`, opened via `data-bs-toggle="modal"`
- Provider change dynamically shows/hides URL, API key, model discovery button
- Default provider on fresh install: `local` with `http://localhost:11434`

## Migration Strategy (v4 → v5)

**Incremental, additive only.** No data loss on existing stores.

1. Bump `DB_VERSION` from 4 to 5 in `src/storage.js`
2. In `openDB()` `onupgradeneeded`, add the `aiSettings` store with `keyPath: 'id'`
3. Existing stores (`entries`, `budgets`, `recurring`, `customCategories`) are untouched — IndexedDB only runs the new migration step
4. No localStorage migration needed — AI settings are a new data domain

**Backward compatibility**: If `loadAiSettings()` returns null, defaults to `{ provider: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'gemma3:4b' }` — identical to current hardcoded behavior.

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| `chatCompletion()` network error | Toast with provider-specific hint (e.g., "¿Está corriendo Ollama?" for local, "API key inválida?" for cloud) |
| `chatCompletion()` timeout | AbortController (30s for categorize, 60s for recommendations), toast timeout message |
| `chatCompletion()` non-200 response | Toast with status code, log to console |
| `testConnection()` failure | Show inline error badge, Save button stays enabled (user may save anyway per spec) |
| `discoverModels()` failure | Fall back to text input for manual model entry |
| `loadAiSettings()` IDB failure | localStorage fallback; if both fail, use defaults silently |
| `saveAiSettings()` IDB failure | localStorage fallback; toast success (user unaware of storage layer) |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. All network calls are client-side fetch to known API endpoints.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Provider adapter message formatting (OpenAI, Gemini, Claude translation) | Mock fetch, verify request body format per provider |
| Unit | `getActiveProvider()` defaults when no settings saved | Mock storage returning null |
| Unit | Settings load/save round-trip | Mock IDB, verify read-after-write |
| Unit | localStorage fallback when IDB unavailable | Mock `isIDBAvailable()` returning false |
| Integration | `autoCategorize()` uses active provider | Mock chatCompletion, verify it's called instead of raw fetch |
| Integration | `renderRecommendations()` uses active provider | Same pattern |
| Manual | Settings modal opens, saves, and reconnects with new provider | Browser testing |
| Manual | DB migration v4→v5 preserves existing entries | Load app with v4 data, verify entries intact after upgrade |

## Open Questions

- [ ] Should model dropdown auto-populate for OpenAI (hardcoded list: gpt-4o, gpt-4o-mini, gpt-3.5-turbo) or only via `/v1/models` discovery?
