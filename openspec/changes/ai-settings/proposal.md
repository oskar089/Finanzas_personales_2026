# Proposal: Multi-Provider AI Settings

## Intent

The app hardcodes Ollama at `localhost:11434` (`app.js` lines 15–16) for auto-categorization and financial analysis. Users who prefer cloud providers (OpenAI, Gemini, Claude) or different local setups have no way to configure this. This change adds a settings UI and provider adapter layer so users can pick any supported AI backend.

## Scope

### In Scope
- Provider adapter layer (`src/ai-providers.js`) with unified `chatCompletion()` and `discoverModels()`
- Settings UI: Bootstrap 5 modal, "⚙️ IA" navbar button, fields for provider, base URL, API key, model
- Persist settings in IndexedDB (new `aiSettings` store, DB v5) with localStorage fallback
- "Test Connection" button that validates provider connectivity before saving
- Backward-compatible defaults (Ollama at localhost:11434) when no settings exist
- Replace hardcoded `OLLAMA_URL`/`OLLAMA_MODEL` in `app.js` with dynamic settings load
- Support providers: Local (OpenAI-compatible), OpenAI, Google Gemini, Anthropic Claude

### Out of Scope
- Streaming responses (current sync fetch pattern preserved)
- Provider cost tracking or usage metering
- Multi-user profiles or settings export/import
- OAuth flows — all providers use API key auth
- Model fine-tuning or prompt customization per provider

## Capabilities

### New Capabilities
- `ai-provider-config`: Provider settings UI, persistence, and test-connection flow

### Modified Capabilities
None — the current `storage` capability gains a new store but its spec-level contract (load/save/migrate) is unchanged.

## Approach

Provider adapter pattern: each provider maps to a config object (name, baseUrl, apiKey, models endpoint) and a `chatCompletion()` function that normalizes requests/responses to the OpenAI chat format. A central `getActiveProvider()` reads persisted settings and returns the adapter. `app.js` calls `getActiveProvider().chatCompletion()` instead of raw fetch to Ollama.

Settings persistence uses the existing IndexedDB wrapper (`src/storage.js`) with a new `aiSettings` object store added in a v4→v5 migration. localStorage holds a single JSON key as fallback.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/ai-providers.js` | New | Provider adapters, chatCompletion(), discoverModels() |
| `src/storage.js` | Modified | Add aiSettings store, loadAiSettings()/saveAiSettings(), DB v5 |
| `app.js` | Modified | Replace hardcoded OLLAMA_URL/OLLAMA_MODEL with settings-driven calls |
| `index.html` | Modified | Settings modal HTML, ⚙️ IA navbar button |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API keys stored client-side | Low (local PWA) | Acceptable for single-user local app; keys never leave the browser |
| CORS blocks cloud provider calls | Low | All four providers support browser fetch from their domains |
| Ollama endpoint change (`/api/generate` → `/v1/chat/completions`) | Medium | Local adapter targets `/v1/chat/completions`; Ollama ≥0.4 supports it |
| DB migration v4→v5 breaks existing data | Low | `onupgradeneeded` adds new store only; existing stores untouched |

## Rollback Plan

Remove `src/ai-providers.js`, revert `app.js` to hardcoded Ollama constants, remove the modal from `index.html`. The DB migration is additive (new store) — downgrading DB_VERSION to 4 ignores the orphan `aiSettings` store harmlessly.

## Dependencies

- Ollama ≥0.4 for `/v1/chat/completions` support (local provider)
- Bootstrap 5 (already in project)
- Browser IndexedDB support (already used)

## Success Criteria

- [ ] User can open settings modal, select a provider, enter credentials, and save
- [ ] "Test Connection" validates provider reachability before saving
- [ ] Auto-categorization and financial analysis use the configured provider
- [ ] Default behavior (no settings) is identical to current Ollama behavior
- [ ] DB migration v4→v5 completes without data loss
- [ ] Existing tests pass after changes
