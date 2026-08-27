# Tasks: Multi-Currency Display Support

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 430–520 |
| 400-line budget risk | High (single PR) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (storage + pure currency layer + tests) → PR 2 (app.js wiring + modal + Excel + tests) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Line budget breakdown: PR 1 ≈ 310–330 (storage.js ~95, finance.js ~65, finance.test.js ~100, storage.test.js ~55); PR 2 ≈ 150–170 (app.js wiring+modal ~115, index.html ~42, Excel ~3). Single PR would land ~460–500 changed lines → over the 400-line review budget; splitting keeps each PR comfortably under.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Storage (DB v6 settings) + pure currency layer | PR 1 | `npx vitest run src/finance.test.js src/storage.test.js` | Vitest (fake-indexeddb) + node REPL calling `convertAmount`/`formatAmount(opts)` | `src/storage.js` + `src/finance.js` — revert restores DB v5 and the legacy `formatAmount` string builder |
| 2 | app.js wiring + settings modal + Excel | PR 2 | `npx vitest run` (full regression) + manual browser checklist | Browser: open app → ⚙️ Ajustes → select USD → rate → save → verify views + reload | `index.html` + `app.js` — revert restores hardcoded `formatAmount` at all call sites |

---

## Phase 1: Storage Layer (DB v6 + settings store)

- [x] 1.1 `src/storage.js` (line 9): Bump `DB_VERSION` 5→6 and update the version comment. Red test: new `src/storage.test.js` it "abre DB v6 y expone el store settings" that opens the DB (fake-indexeddb/auto, as existing tests) and asserts `db.objectStoreNames.contains('settings')` — fails on v5.
- [x] 1.2 `src/storage.js`: Add `SETTINGS_STORE = 'settings'` (after line 14) and `LS_SETTINGS_KEY = 'finanzas:settings:v1'` (after line 19). Red test: same as 1.1 plus the round-trip tests below referencing the new constants.
- [x] 1.3 `src/storage.js`: In `openDB()` `onupgradeneeded` (after the aiSettings block, lines 52–54): `if (!db.objectStoreNames.contains(SETTINGS_STORE)) { db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' }); }`. Greens the 1.1 Red test. Migration is additive only — existing stores (`entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`) untouched, zero data loss.
- [x] 1.4 `src/storage.js`: Add `idbGetSettings(db)` / `idbPutSettings(db, record)` mirroring `idbGetAiSettings`/`idbPutAiSettings` (lines 190–208): `get('active')` returning `result || null`, `put(record)` with `tx.oncomplete`. Red test: settings round-trip it (save then load).
- [x] 1.5 `src/storage.js`: Add `lsLoadSettings()` / `lsSaveSettings(settings)` mirroring lines 284–297 — JSON parse with object guard, returning `null` on missing/corrupt data. Red test: localStorage fallback it (see 1.6).
- [x] 1.6 `src/storage.js`: Implement `loadCurrencySettings()` — `isIDBAvailable()` gate, IDB `get` via `openDB()`, `catch` → `lsLoadSettings()`, null if neither exists (mirror `loadAiSettings`, lines 475–486). Greens the round-trip and LS fallback Red tests.
- [x] 1.7 `src/storage.js`: Implement `saveCurrencySettings(settings)` — build record `{ ...settings, id: 'active', updatedAt: Date.now() }`, IDB `put` + `lsSaveSettings(record)`; on IDB failure write LS only (mirror `saveAiSettings`, lines 488–524). Greens round-trip assertions (`id === 'active'`, `typeof updatedAt === 'number'`).
- [x] 1.8 `src/storage.js`: Implement `clearCurrencySettings()` — IDB transaction deleting key `'active'` + `localStorage.removeItem(LS_SETTINGS_KEY)` (mirror the null branch of `saveAiSettings`, lines 489–508). Export all three functions in `module.exports` (line 530) and `window.storage` (line 534). Red test: clear it — save → clear → load returns null and LS key is gone.

## Phase 2: Pure Currency Layer (`src/finance.js`)

- [x] 2.1 Add the `CURRENCIES` catalog (after `INCOME_CATEGORIES`, line 26): `EUR {locale:'es-ES',decimals:2}`, `USD en-US/2`, `GBP en-GB/2`, `ARS es-AR/2`, `MXN es-MX/2`, `BRL pt-BR/2`, `JPY ja-JP/0`, `CHF de-CH/2`; plus `BASE_CURRENCY = 'EUR'` and `DEFAULT_FORMAT = { displayCurrency:'EUR', rate:1, locale:'es-ES', decimals:2 }`. Red test: new `describe` asserting the catalog maps each of the 8 codes to its locale and decimals (JPY → 0).
- [x] 2.2 Add module-level `let activeFormat = { ...DEFAULT_FORMAT }`, `setDisplayConfig(config)` — normalizes against the catalog (unknown code → EUR), `rate: Number(config?.rate) > 0 ? Number(config.rate) : 1` (design pseudocode lines 110–119) — and `getActiveFormat()`. Red test: `getActiveFormat()` default is EUR/1/es-ES/2; `setDisplayConfig({displayCurrency:'XXX', rate:-5})` normalizes to EUR and rate 1.
- [x] 2.3 Add `convertAmount(amount, rate)` — pure: `Number(amount) * (Number(rate) > 0 ? Number(rate) : 1)` (rate ≤ 0 / NaN → passthrough). Red test: `convertAmount(1500, 1.1) === 1650`; `convertAmount(1500, 0) / -1 / NaN` each `=== 1500`.
- [x] 2.4 Rewrite `formatAmount(n, opts = {})` (lines 62–70) as parameterized, keeping byte-identical legacy default: when the active (or explicit `opts.currency`) config is EUR/es-ES, PIN the existing string builder `'€' + num.toLocaleString('es-ES', {min:2,max:2})` including the `isNaN → '€0,00'` guard; for non-default currencies use `convertAmount` then `Intl.NumberFormat(locale, { style:'currency', currency, minimumFractionDigits:decimals, maximumFractionDigits:decimals })`. Red test: the 4 existing back-compat tests (finance.test.js:41–62) stay green + new exact-value tests after `setDisplayConfig(null)`: `formatAmount(1500) === '€1500,00'`, `formatAmount(0) === '€0,00'`, `formatAmount('500') === '€500,00'`.
- [x] 2.5 JPY zero-decimal path: `formatAmount(1650, { currency:'JPY', rate:1 })` → `￥1,650` (full-width `￥` U+FFE5, 0 fraction digits from catalog). Red test: exact-value JPY test (asserts no `.00` suffix).
- [x] 2.6 Add `convertAmount`, `setDisplayConfig`, `getActiveFormat`, `CURRENCIES` to `module.exports` (lines 349–372) and the `window.*` block (lines 376–397) — `formatAmount` stays exported as-is. Red test: cache it — `setDisplayConfig({ displayCurrency:'USD', rate:1.1 })` then `formatAmount(1500) === '$1,650.00'`; reset with `setDisplayConfig(null)` and assert EUR output again.

## Phase 3: `app.js` Wiring

- [x] 3.1 Add the single switch point `fmt(n)` near the other top-level helpers (before the AI Settings section, ~line 74): `return formatAmount(n)` (reads the cached `activeFormat` inside the parameterized `formatAmount`; no `fmt` identifier exists today — verified). No unit harness for app.js: the pure-layer proxy Red tests are the 2.6 cache tests, which prove set-config → format flow.
- [x] 3.2 Add `loadCurrencySettingsFromStorage()` mirroring `loadAiSettingsFromStorage()` (lines 76–83): `const s = await storage.loadCurrencySettings(); finance.setDisplayConfig(s ? { displayCurrency: s.displayCurrency, rate: s.rates?.[s.displayCurrency] } : null);` with `catch` → `finance.setDisplayConfig(null)` (default EUR, byte-identical). Red proxy: storage round-trip (1.6) + cache tests (2.6).
- [x] 3.3 `init()` (line 1492): insert `await loadCurrencySettingsFromStorage();` between `loadAiSettingsFromStorage()` (1497) and `checkAndGenerateRecurring()` (1498). Existing `render()` at line 1510 re-renders after all boot loads — no extra render needed. Verified manually in 4.6 (reload persistence).
- [x] 3.4 Replace `formatAmount(` → `fmt(` at the 13 UI display call sites: **691** (renderTable row), **721, 722, 723, 726, 730** (renderSummary totals + balance), **852, 853, 861** (renderDashboard avg/projection/comparison), **1074, 1082** (renderCharts trend tooltip/ticks), **1131** (renderBudgets progress), **1225** (renderRecurring). Checkable: `grep formatAmount app.js` — remaining sites are exactly the 8 AI-prompt sites (3.5), the `fmt` definition, and Excel totals line 1385 (Phase 5). Red proxy: 2.6 cache tests; UI assertions manual per 4.6.
- [x] 3.5 Confirm the 8 AI-prompt sites **928, 931, 932, 945, 952, 953, 954, 955** (`renderRecommendations`, lines 875–964 — `topCategories`, `comparisonText`, prompt body) stay on base `formatAmount(n)` — NO change. Checkable: grep shows those lines still read `formatAmount(` after 3.4; the prompt body keeps base-€ numbers (NFR "AI-prompt amounts in base EUR").
- [x] 3.6 Re-render on save: `render()` (lines 1334–1342) recomposes table/summary/dashboard/budgets/trend/recurring/charts from `entries` — no per-view plumbing needed. The Phase-4 save handler MUST call `render()` after `finance.setDisplayConfig(...)` so every display site picks up the new config.

## Phase 4: Settings Modal (index.html + app.js)

- [x] 4.1 `index.html`: Add the `⚙️ Ajustes` navbar button after `btnAiSettings` (line 25): `id="btnCurrencySettings"`, `data-bs-toggle="modal" data-bs-target="#currencySettingsModal"`. Red: none (markup) — 4.6 manual open check.
- [x] 4.2 `index.html`: Add `#currencySettingsModal` Bootstrap modal after `#aiSettingsModal` (ends ~line 466): `<select id="currencySelect">` with the curated catalog only (EUR, USD, GBP, ARS, MXN, BRL, JPY, CHF), `<input type="number" id="currencyRate" step="any" min="0.0001">`, hint text ("1 EUR = X en moneda de visualización; EUR no requiere tasa"), footer with Cancel (`data-bs-dismiss="modal"`, no persistence — Bootstrap default) and `#btnSaveCurrencySettings`. Modal title `⚙️ Ajustes de moneda`.
- [x] 4.3 `index.html`: Wrap the `#amount` input (line 51) in an `input-group` with a static `<span class="input-group-text">€</span>` — hardcoded base-EUR glyph (input always EUR per spec). Budget/recurring form glyphs (app.js:1150, 1261) keep their existing € affordance.
- [x] 4.4 `app.js`: Add `setupCurrencySettingsModal()` mirroring `setupAiSettingsModal()` (lines 190–346), with `if (!modalEl) return;` guard: on `shown.bs.modal` prefill `#currencySelect` from `finance.getActiveFormat().displayCurrency` and `#currencyRate` from the active rate (1 for EUR, input disabled/hidden for EUR); on currency change, repopulate the rate field from the last-saved `rates[code]` when known; Save handler: validate `Number(rate) > 0` → else error toast ("La tasa tiene que ser mayor a 0.") and modal stays open, nothing persisted (spec "Reject an invalid rate"); on valid: `await storage.saveCurrencySettings({ baseCurrency:'EUR', displayCurrency, rates: { [displayCurrency]: rate } })`, `finance.setDisplayConfig({ displayCurrency, rate })`, `render()`, hide modal, success toast. Cancel/backdrop: no handler → no persistence; module cache untouched so the previous display config stays in effect.
- [x] 4.5 `app.js` `init()` (line 1516): call `setupCurrencySettingsModal();` right after `setupAiSettingsModal();`.
- [x] 4.6 Manual browser verification (PR 2 gate, local server / `python -m http.server` or equivalent): modal opens from navbar; save USD rate 1.1 → table/summary/dashboard/budgets/recurring/charts show converted en-US values, input glyph still €; reload page → saved currency persists (IDB, with LS fallback verified by clearing IDB in DevTools); switch back to EUR → original €/es-ES values restored byte-identical; invalid rate 0 / -1 → error toast + modal stays open + no persist; ⚙️ IA modal opens/behaves unchanged; mobile viewport (<576px) modal usable without horizontal scroll; DevTools offline → conversion and settings save work; export XLSX → rows raw base numbers, totals Monto cell raw base balance, totals Description label in display currency.

## Phase 5: Excel (app.js)

- [x] 5.1 `app.js` `exportXLSX()` totals row (lines 1377–1387): change `'Descripción'` (line 1385) from `formatAmount(...)` ×3 to `fmt(...)` ×3 (display currency); leave `'Monto': totals.balance` (1386) as the raw base number; leave row `'Monto': Number(e.monto)` (1374) unchanged. Import side untouched: `monto: Number(row.Monto || row.monto || 0)` (1449) stays raw base, and totals rows are already skipped on import by the `if (!row.Fecha && !row.Tipo) return;` guard (1439). Asymmetry per spec: display-currency conversion appears ONLY in the totals Description label, never in numeric cells. Red: none (XLSX/DOM not unit-testable in this repo) — covered by manual checklist item in 4.6.

## Phase 6: Tests (finalize + full suite)

- [x] 6.1 `src/finance.test.js`: keep the 4 existing `formatAmount()` back-compat tests (lines 41–62) unchanged; consolidate the new describes written Red-first in Phase 2 — `convertAmount()`, `formatAmount()` with currency/rate overrides, JPY zero-decimal, `setDisplayConfig()`/`getActiveFormat()` cache + reset-to-default. Verify every new it is exact-value (byte-identical contract), not regex-loose.
- [x] 6.2 `src/storage.test.js`: consolidate the settings suite mirroring the aiSettings block (lines 171–212): round-trip (id `'active'`, `updatedAt` number), localStorage fallback with `globalThis.indexedDB = undefined` (key `finanzas:settings:v1`), clear removes, DB v6 store presence (via fake-indexeddb open).
- [x] 6.3 Run `npx vitest run` — full suite green: all 148 existing tests pass unchanged (zero regressions in legacy `formatAmount`/storage paths) plus the new currency/settings tests (~15).

## Definition of Done

- [x] All 6 phases complete, every checkbox checked
- [x] `npx vitest run` green: 167/167 (148 legacy tests unchanged + 19 new currency/settings tests), no legacy test modified
- [x] Slice 1 (storage + pure layer + tests) landed as commit `8adb586`; slice 2 (wiring + modal + Excel + manual checklist) landed as commit `69471e4`; both pushed to `main`
- [x] Manual checklist verified by the user in browser: all 9 checklist items pass (incl. byte-identical EUR back-compat on reload, offline operation, and Excel totals-label conversion)