# Proposal: Multi-Currency Display Support

## Intent

The app stores every amount as a plain EUR number and hardcodes `€` + `es-ES` formatting in `formatAmount()` (`src/finance.js:62-70`), used at ~17 call sites in `app.js`. Users cannot view their finances in any other currency. This change adds a global display currency (EUR stays the fixed storage base) with a manual exchange rate per currency, converts amounts at the render boundary only, and adds a "⚙️ Ajustes" settings modal.

## Scope

### In Scope
- Display-conversion boundary in the pure layer: parameterized `formatAmount(n, opts)` + `convertAmount()`, with a module-level display-config cache (`setDisplayConfig`/`getActiveFormat`)
- Settings persistence: new IndexedDB `settings` store (DB v6, additive) with a localStorage mirror, following the existing `aiSettings` dual-write pattern
- "⚙️ Ajustes" Bootstrap modal: curated currency catalog (EUR, USD, GBP, ARS, MXN, BRL, JPY + CHF) and a manual rate input validated to be greater than 0
- Single `fmt()` switch point in `app.js`: the 13 UI display sites convert; the 8 AI-prompt sites in `renderRecommendations` stay on base EUR per the NFR ("AI-prompt amounts in base EUR")
- Excel: row amounts and the totals number cell stay raw base EUR; only the totals Description label converts to the display currency
- Byte-identical backward compatibility: with no settings configured, all output matches the current `€` + `es-ES` formatting exactly

### Out of Scope
- Per-entry currency selection (one global display currency applies to all entries)
- Live/automatic exchange-rate fetching or API keys — manual rates only, fully offline
- Rewriting or storing entries in any currency other than base EUR
- Per-row currency conversion in the Excel export/import in v1
- Exchange-rate history or per-currency historical records

## Capabilities

### New Capabilities
- `currency-settings`: display currency + manual rate persistence, base→display conversion at the render boundary, and the settings modal

### Modified Capabilities
None — `storage` gains a new store but its spec-level contract (load/save/migrate) is unchanged; `formatAmount` remains backward compatible.

## Approach

Keep EUR as the fixed storage base and add a thin display-conversion boundary between the data model and the rendered UI. A `settings` store (DB v6, additive) holds a single `'active'` record with the display currency and a manual rate (1 EUR = X). `formatAmount(n, opts)` in `src/finance.js` replaces the hardcoded `€` + `es-ES` formatter; its default path is byte-identical to today, with the default-EUR branch pinned to the legacy string builder. A module-level display-config cache is loaded at boot and refreshed on save; `app.js` routes display sites through a single `fmt()` helper while AI-prompt sites stay in base EUR.

Persistence follows the `aiSettings` pattern: IndexedDB store with `keyPath: 'id'` and a single `'active'` record, a `finanzas:settings:v1` localStorage key as fallback, and an additive `DB_VERSION` 5→6 migration that touches no existing store.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/finance.js` | Modified | `CURRENCIES` catalog, `convertAmount()`, parameterized `formatAmount()` with pinned legacy EUR branch, `setDisplayConfig()`/`getActiveFormat()` |
| `src/storage.js` | Modified | DB v6 `settings` store, `loadCurrencySettings()`/`saveCurrencySettings()`/`clearCurrencySettings()`, LS helpers |
| `app.js` | Modified | `fmt()` switch point at the 13 display sites, boot loader, settings modal wiring, Excel totals label |
| `index.html` | Modified | "⚙️ Ajustes" navbar button, `#currencySettingsModal`, static `€` input-group glyph on `#amount` |
| Tests | Modified | `finance.test.js` + `storage.test.js`: convertAmount/formatAmount catalog, cache, JPY, settings persistence, LS fallback |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Floating-point noise on conversion (`1500 × 1.1 = 1650.0000000000002`) | Certain | `convertAmount` rounds the product to 9 decimals; exact-value tests pin outputs |
| Runtime-dependent Intl output (grouping below 5 digits, full-width yen glyph) | Medium | Default-EUR branch pinned to the legacy string builder; exact-value tests pinned to actual runtime bytes |
| DB migration v5→v6 breaks existing data | Low | Additive `onupgradeneeded` adds the `settings` store only; existing stores untouched |
| Byte-identical back-compat regression when no settings exist | Low | The 4 legacy `formatAmount` tests stay unchanged; manual reload check re-verifies EUR output |

## Rollback Plan

Revert `src/finance.js` (drop `CURRENCIES`/`convertAmount`/parameterized `formatAmount`), `src/storage.js` (`DB_VERSION` back to 5, remove the `settings` store), `app.js` (restore `formatAmount(` at the display sites), and `index.html` (remove the modal and the EUR glyph). The migration is additive — downgrading to DB v5 ignores the orphan `settings` store harmlessly. Currency settings are display-only: rollback loses display preferences, never entry data.

## Dependencies

- Bootstrap 5 (already in the project)
- Browser IndexedDB support and `Intl.NumberFormat` (already used)
- No network: conversion relies only on the locally saved manual rate

## Success Criteria

- [ ] User can open the Settings modal, pick a display currency, enter a manual rate, and save
- [ ] All views (list, summary, dashboard, budgets, recurring, charts, Excel totals label) render converted amounts in the display currency
- [ ] Invalid rates (≤ 0) are rejected with an error toast, nothing is persisted, and the modal stays open
- [ ] Reload restores the saved currency from IndexedDB (localStorage fallback)
- [ ] Switching the display currency back to EUR restores byte-identical `€` + `es-ES` output
- [ ] DB migration v5→v6 is additive with zero data loss on existing stores
- [ ] Existing tests pass; the legacy back-compat tests remain unchanged