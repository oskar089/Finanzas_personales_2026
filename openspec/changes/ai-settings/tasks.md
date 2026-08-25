# Tasks: Multi-Provider AI Settings

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450–550 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (storage + adapters) → PR 2 (UI + wiring) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Storage + adapter layer | PR 1 | `npx vitest run src/ai-providers.test.js` | Manual: node REPL calling chatCompletion with mocked fetch | `src/ai-providers.js` + `src/storage.js` changes — revert removes adapters, restores DB v4 |
| 2 | Settings UI + app.js wiring | PR 2 | Manual: open modal, save settings, trigger autoCategorize | Browser: open app → ⚙️ IA → configure provider → save → auto-categorize | `index.html` modal + `app.js` changes — revert restores hardcoded Ollama |

---

## Phase 1: Storage Layer (DB v5 + aiSettings)

- [x] 1.1 `src/storage.js`: Bump `DB_VERSION` 4→5, add `AI_SETTINGS_STORE = 'aiSettings'`, add `LS_AI_SETTINGS_KEY = 'finanzas:ai-settings:v1'`
- [x] 1.2 `src/storage.js`: In `openDB()` `onupgradeneeded`, add `aiSettings` objectStore with `keyPath: 'id'`
- [x] 1.3 `src/storage.js`: Implement `loadAiSettings()` — read from IDB `aiSettings` store (key `'active'`), fall back to localStorage, return null if neither exists
- [x] 1.4 `src/storage.js`: Implement `saveAiSettings(settings)` — write to IDB + localStorage sync, set `updatedAt: Date.now()`
- [x] 1.5 `src/storage.js`: Export `loadAiSettings` and `saveAiSettings` (follow existing `window.storage` export pattern)

## Phase 2: Provider Adapter Layer

- [x] 2.1 Create `src/ai-providers.js` with `PROVIDERS` config map: `local`, `openai`, `gemini`, `claude` — each with `name`, `baseUrl`, `chatEndpoint`, `modelsEndpoint`
- [x] 2.2 Implement `getActiveProvider()` — calls `storage.loadAiSettings()`, returns defaults `{ provider: 'local', baseUrl: 'http://localhost:11434', apiKey: '', model: 'gemma3:4b' }` when null
- [x] 2.3 Implement `openaiCompatibleFetch(settings, messages, opts)` — POST `{baseUrl}{chatEndpoint}` with `{ model, messages, stream: false, temperature, max_tokens }`, returns `response.choices[0].message.content`
- [x] 2.4 Implement `geminiFetch(settings, messages, opts)` — translate messages to Gemini `contents`/`parts` format, POST with `?key={apiKey}`, translate response back to OpenAI format
- [x] 2.5 Implement `claudeFetch(settings, messages, opts)` — POST with `x-api-key` and `anthropic-version` headers, `system` param extracted from system message, translate response back to OpenAI format
- [x] 2.6 Implement `chatCompletion(messages, opts)` — dispatcher that reads active provider and routes to the correct fetch function via switch
- [x] 2.7 Implement `discoverModels(settings)` — GET `{baseUrl}/v1/models`, return `string[]` of model IDs, return `[]` on failure (no throw)
- [x] 2.8 Implement `testConnection(settings)` — send minimal chat request, return `{ ok: true }` or `{ ok: false, error: string }`
- [x] 2.9 Export all public functions via `window.aiProviders`

## Phase 3: Settings UI (Modal + Navbar)

- [ ] 3.1 `index.html`: Add `<script src="src/ai-providers.js">` before `app.js` script tag
- [ ] 3.2 `index.html`: Add `⚙️ IA` button in navbar next to dark mode toggle, `data-bs-toggle="modal" data-bs-target="#aiSettingsModal"`
- [ ] 3.3 `index.html`: Add `#aiSettingsModal` Bootstrap modal with fields: provider dropdown, base URL input, API key input (password toggle), model input, 🔍 discover button, test connection button, cancel/save buttons
- [ ] 3.4 `index.html`: Modal body wired with IDs matching design: `#aiProvider`, `#aiBaseUrl`, `#aiApiKey`, `#aiModel`, `#btnDiscoverModels`, `#btnTestConnection`, `#aiConnectionStatus`

## Phase 4: App.js Integration

- [ ] 4.1 `app.js`: Remove `OLLAMA_URL` and `OLLAMA_MODEL` constants (lines 15–16)
- [ ] 4.2 `app.js`: In `autoCategorize()` (line 196): replace `fetch(OLLAMA_URL, ...)` with `aiProviders.chatCompletion([...messages], { temperature: 0.1, max_tokens: 20 })` — adapt response parsing from `data.response` to `data.choices[0].message.content`
- [ ] 4.3 `app.js`: In `renderRecommendations()` (line 802): same replacement — replace raw fetch with `aiProviders.chatCompletion()`, adapt response parsing
- [ ] 4.4 `app.js`: Add settings modal event wiring: load current settings on modal open, populate fields, handle provider change (show/hide URL, API key, discover button), wire save/cancel/test-discover buttons
- [ ] 4.5 `app.js`: Add `loadAiSettings()` call at app init (before AI-dependent features are used) to cache active provider config

## Phase 5: Testing

- [x] 5.1 Create `src/ai-providers.test.js`: test `chatCompletion` dispatches to correct adapter for each provider
- [x] 5.2 Test `openaiCompatibleFetch` request body format and response parsing
- [x] 5.3 Test `geminiFetch` message translation (messages → contents/parts) and response normalization
- [x] 5.4 Test `claudeFetch` header format, system param extraction, and response normalization
- [x] 5.5 Test `getActiveProvider` returns defaults when storage returns null
- [x] 5.6 Test `discoverModels` returns model list on success, empty array on failure
- [x] 5.7 Test `loadAiSettings`/`saveAiSettings` round-trip (add to `src/storage.test.js`)
- [x] 5.8 Test localStorage fallback when IDB unavailable
