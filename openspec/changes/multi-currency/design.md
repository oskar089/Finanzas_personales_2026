# Design: Multi-Currency Display Support

## Technical Approach

Keep EUR as the fixed storage base currency and add a thin **display-conversion boundary** between the data model and the rendered UI. A new `settings` store (DB v6, additive) holds a single `'active'` record with the display currency and a manual exchange rate (1 EUR = X). A parameterized `formatAmount(n, opts)` in `src/finance.js` replaces the hardcoded `€`+`es-ES` formatter; its **default path is byte-identical to today**. A single module-level display-config cache is loaded at boot and updated on save, and `app.js` routes display sites through a single `fmt()` helper while AI-prompt sites stay in base EUR per the NFR.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  app.js                                                       │
│  boot: loadCurrencySettings() → finance.setDisplayConfig(cfg) │
│  all DISPLAY sites: fmt(n)                                    │
│  AI-prompt sites:   formatAmount(n)  (base EUR, unchanged)    │
│  Excel rows: Number(e.monto)  (raw base, unchanged)           │
│  setupCurrencySettingsModal() → save → setDisplayConfig → render() │
└───────────────────────────────┬───────────────────────────────┘
                                │ fmt(n) reads cached config
                                ▼
┌───────────────────────────────────────────────────────────────┐
│  src/finance.js  (pure layer)                                 │
│  CURRENCIES catalog (code→{ glyph? shortcut, locale, decimals })│
│  convertAmount(amount, rate)        — pure, rate>0 fallback 1 │
│  formatAmount(n, opts)              — convert then Intl format │
│  setDisplayConfig(config) / getActiveFormat()  — cached reader │
└───────────────────────────────┬───────────────────────────────┘
                                │ load/save/clear
                                ▼
┌───────────────────────────────────────────────────────────────┐
│  src/storage.js                                               │
│  loadCurrencySettings() / saveCurrencySettings(s) / clear…()  │
│  → IndexedDB settings store (DB v6) + localStorage mirror     │
└───────────────────────────────────────────────────────────────┘
```

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Single switch point | Edit ~17 call sites vs a `fmt()` wrapper | Editing each site: explicit, but noisy diff and easy to miss one. `fmt()` wrapper: one indirection, single place to change semantics. | **Single `fmt()` helper (app.js local)** — minimal-touch, one switch point; then mechanically replace `formatAmount(` → `fmt(` at display sites |
| Settings shape | `{currency, rate}` flat vs nested catalog | Flat: simplest. Nested: future-proof but YAGNI for v1. Store only user choices; catalog is code, not data. | **Flat `{ baseCurrency, displayCurrency, rates }`** — `rates` maps code→manual rate |
| JPY zero-decimal | Manual `(decimals===0)` logic vs `Intl.NumberFormat` per-currency fraction digits | Manual: fragile. `Intl` with `style:'currency'` auto-selects 0 for JPY. But sample-clipping for other decimals uses fixed 2. | **`Intl.NumberFormat(locale, {style:'currency', currency, minFractionDigits, maxFractionDigits})`** with per-currency `decimals` from catalog, applied after conversion |
| CHF inclusion | Include CHF in v1 vs keep out | Include: 8 options, `de-CH` locale added. Keep out: 7 curated as spec primary. Spec marks CHF "optional". | **Include CHF** — trivial (`de-CH` + `0.95` default), no code cost, satisfies "when opted in" |
| Display config caching | Re-fetch settings per call vs cached module state | Re-fetch: always fresh, but async per render (each call site can't await). Cached sync reader: needed because `formatAmount` is synchronous. | **Module-level cache via `setDisplayConfig(config)` / `getActiveFormat()`** — synchronous, loaded at boot, refreshed on save |
| AI prompt amounts | Convert vs keep base | Converting prompts gives LLM display-currency numbers, but NFR explicitly requires AI-prompt amounts in base EUR. | **Keep base EUR** — `formatAmount(n)` unchanged at prompt sites (928, 931, 932, 945, 952–955) |

## Data Model

### Settings record (IndexedDB `settings` store, DB v6)

Single `'active'` record, same pattern as `aiSettings`:

```js
{
  id: 'active',
  baseCurrency: 'EUR',                 // always 'EUR' in v1 (fixed base)
  displayCurrency: 'EUR' | 'USD' | 'GBP' | 'ARS' | 'MXN' | 'BRL' | 'JPY' | 'CHF',
  rates: {                             // code → manual rate (1 EUR = X display)
    USD: 1.1,
    ARS: 1200,
    // ... only codes the user explicitly set are present; displayCurrency's own rate is required
  },
  updatedAt: number                    // Date.now()
}
```

- `baseCurrency` is stored for forward compatibility but is **locked to `'EUR'`** in v1 (closed decision 3).
- The active `displayCurrency` **must** have an entry in `rates`; the saved `rates` object always contains it.
- Example persisted: `{ id:'active', baseCurrency:'EUR', displayCurrency:'USD', rates:{ USD:1.1 }, updatedAt: 1750000000000 }`.

### localStorage fallback key
`finanzas:settings:v1` — same JSON shape, single object.

### Default / no-settings (byte-identical back-compat)
No record exists ⇒ `getActiveFormat()` returns `{ displayCurrency:'EUR', rate:1, locale:'es-ES', decimals:2 }` — identical output to the current `formatAmount`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/finance.js` | **Modify** | Add `CURRENCIES` catalog, `convertAmount()`, extend `formatAmount(n, opts)`, add `setDisplayConfig()`/`getActiveFormat()`; export + `window.*` |
| `src/storage.js` | **Modify** | `DB_VERSION` 5→6, add `SETTINGS_STORE='settings'`, `loadCurrencySettings()`/`saveCurrencySettings()`/`clearCurrencySettings()`, LS helpers + key |
| `app.js` | **Modify** | `fmt()` helper, `loadCurrencySettingsFromStorage()` at init, replace `formatAmount(` → `fmt(` at display sites, `setupCurrencySettingsModal()`, re-render on save |
| `index.html` | **Modify** | Add `⚙️ Ajustes` navbar button + `#currencySettingsModal`, tag the `#amount` input with an EUR glyph for base-input affordance |
| `src/finance.test.js` | **Modify** | Back-compat default tests + new `convertAmount` / `formatAmount(opts)` / JPY / cache tests |
| `src/storage.test.js` | **Modify** | Settings round-trip, localStorage fallback, DB v6 store presence |

## Key Functions — Pseudocode

### `src/finance.js`

```js
// --- Currency catalog (code → { locale, decimals }) ---
const CURRENCIES = {
  EUR: { locale: 'es-ES', decimals: 2 },
  USD: { locale: 'en-US', decimals: 2 },
  GBP: { locale: 'en-GB', decimals: 2 },
  ARS: { locale: 'es-AR', decimals: 2 },
  MXN: { locale: 'es-MX', decimals: 2 },
  BRL: { locale: 'pt-BR', decimals: 2 },
  JPY: { locale: 'ja-JP', decimals: 0 },
  CHF: { locale: 'de-CH', decimals: 2 },
};
const BASE_CURRENCY = 'EUR';
const DEFAULT_FORMAT = { displayCurrency: 'EUR', rate: 1, locale: 'es-ES', decimals: 2 };

// --- Module-level cached display config (sync reader for sync formatter) ---
let activeFormat = { ...DEFAULT_FORMAT };

function setDisplayConfig(config) {
  // config: { displayCurrency, rate } — normalizes against catalog, defaults 'EUR'/1
  const cur = CURRENCIES[config?.displayCurrency] || CURRENCIES.EUR;
  activeFormat = {
    displayCurrency: config?.displayCurrency === 'EUR' ? 'EUR' : (CURRENCIES[config?.displayCurrency] ? config.displayCurrency : 'EUR'),
    rate: Number(config?.rate) > 0 ? Number(config.rate) : 1,
    locale: cur.locale,
    decimals: cur.decimals,
  };
}

function getActiveFormat() { return activeFormat; }

// Pure: amount * rate. rate<=0 or NaN falls back to 1 (EUR passthrough).
function convertAmount(amount, rate) {
  const r = Number(rate);
  return Number(amount) * (r > 0 ? r : 1);
}

function formatAmount(n, opts = {}) {
  // opts: { currency?, rate? } — explicit overrides; defaults read activeFormat.
  // Back-compat: formatAmount(n) with no settings ⇒ identical to legacy € + es-ES.
  const cfg = opts.currency
    ? { currency: opts.currency, rate: (opts.rate ?? 1), ...CURRENCIES[opts.currency] }
    : activeFormat;

  const num = Number(n);
  if (isNaN(num)) return currencyGlyph(cfg.displayCurrency) + '0,00'; // legacy '€0,00' shape
  const converted = convertAmount(num, cfg.rate);

  const formatted = converted.toLocaleString(cfg.locale, {
    style: 'currency',
    currency: cfg.displayCurrency,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  });
  return formatted;
}
```

Notes on the format strategy:
- Legacy `formatAmount(n)` default path produces `€1500,00` for 1500 in this environment (verified `finance.test.js:890-891`) — `num.toLocaleString('es-ES', {min:2, max:2})` emits no thousands separator below 5 digits (`1500,00`, not `1.500,00`; grouping only appears at ≥5 digits, e.g. `€12.345,00`). Note that `Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'})` in this environment emits `1500,00 €` (trailing glyph) — which is exactly why **the default-EUR branch is pinned to the legacy string builder `'€' + num.toLocaleString('es-ES',{min:2,max:2})`** (closed decision 7): the shipped `formatAmount` uses the legacy builder for the `activeFormat.displayCurrency==='EUR' && locale==='es-ES'` case and `Intl` only for non-default currencies. The pin guarantees old==new output in every environment regardless of runtime grouping rules.
- **JPY zero decimals**: `minimumFractionDigits:0, maximumFractionDigits:0` yields `￥1,650` (no fraction digits) in the `ja-JP` locale — the locale renders the FULL-WIDTH yen sign `￥` (U+FFE5), not `¥` (U+00A5), and comma-grouped digits (verified `finance.test.js:877-879`). Non-JPY keep 2.
- Non-`isNaN` guard keeps `formatAmount(0) === '€0,00'` (test line 49) and `formatAmount('500') === '€500,00'` (line 60).
- **`convertAmount` rounding deviation (implemented)** (`finance.js:64-70`): the shipped `convertAmount` rounds the product to 9 decimal places — `Math.round(Number(amount) * rate * 1e9) / 1e9` — which the design pseudocode did not show. Raw `1500 * 1.1` evaluates to `1650.0000000000002` in IEEE-754; the 1e9 rounding is what makes the exact assertion `convertAmount(1500, 1.1) === 1650` (and the downstream `$1,650.00` / `€`-chain outputs) hold deterministically. Real amounts never carry ~9 fraction digits, so legitimate precision is unaffected.

### `src/storage.js` (DB v6)

```js
const DB_VERSION = 6; // v6: añadido store settings
const SETTINGS_STORE = 'settings';
const LS_SETTINGS_KEY = 'finanzas:settings:v1';

// In openDB() onupgradeneeded — follows storage.js:38-55 pattern:
if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
  db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
}

// idbGetSettings / idbPutSettings: get('active') / put(record) — mirror idbGetAiSettings (storage.js:190-208)

// LS helpers — mirror lsLoadAiSettings/lsSaveAiSettings (storage.js:284-297)

async function loadCurrencySettings() { /* IDB → LS fallback, null if none */ }
async function saveCurrencySettings(settings) { /* record = {...settings, id:'active', updatedAt}; IDB put + LS sync; on IDB fail → LS only */ }
async function clearCurrencySettings() { /* IDB delete('active') + removeItem LS */ }
```

All three follow the exact `loadAiSettings`/`saveAiSettings` error/fallback structure (`storage.js:475-524`) and are added to both the `module.exports` and `window.storage` blocks.

## Wiring (`app.js`)

### The single switch point: `fmt()`

Add one local helper and use it **only at display call sites**:

```js
// Near top-level helpers: convert-then-format using the active display config.
function fmt(n) {
  return formatAmount(n); // reads activeFormat via getActiveFormat() internally
}
```

- `formatAmount(n)` (no opts) already reads the cached `activeFormat`; `fmt(n)` is a pure alias that makes the intent ("display this in the active currency") explicit and gives a single mechanical replacement point.
- **Display call sites** (replace `formatAmount(` → `fmt(`): `app.js` lines **691, 721, 722, 723, 726, 730, 852, 853, 861, 1074, 1082, 1131, 1225, 1385**.
- **AI-prompt call sites** (keep `formatAmount(n)` = base EUR): lines **928, 931, 932, 945, 952, 953, 954, 955** — these build `topCategories`, `budgetStatus`, `comparisonText`, and the prompt body (`renderRecommendations`, lines 875–964). Per NFR "AI-prompt amounts remain in base EUR", they MUST NOT convert.

> Justification: converting the ~14 display sites through one `fmt()` alias keeps the diff small and the semantics at a single point; keeping the 8 AI-prompt sites on the base `formatAmount(n)` honors the "AI-prompt amounts in base EUR" NFR without a second code path.

### Settings modal wiring

- New navbar button after `btnAiSettings` (index.html:25): `⚙️ Ajustes` → `data-bs-toggle="modal" data-bs-target="#currencySettingsModal"`.
- `setupCurrencySettingsModal()`: on open, prefill currency selector (`displayCurrency`) and rate input from `finance.getActiveFormat()` (or settings). Currency change repopulates the rate field from the last-saved `rates` for that code when known. Rate validation: `Number(rate) > 0` else error toast, modal stays open (spec "Reject an invalid rate"). Save button: build settings, `await storage.saveCurrencySettings(...)`, `finance.setDisplayConfig({displayCurrency, rate})`, `render()`, success toast. Cancel/backdrop: no persistence, modal closes (spec "Close or cancel without saving").

### Boot

Add `loadCurrencySettingsFromStorage()` mirroring `loadAiSettingsFromStorage()` (`app.js:76-81`), called in `init()` between `loadAiSettingsFromStorage()` and `checkAndGenerateRecurring()`:

```js
async function loadCurrencySettingsFromStorage() {
  try {
    const s = await storage.loadCurrencySettings();
    finance.setDisplayConfig(s ? { displayCurrency: s.displayCurrency, rate: s.rates?.[s.displayCurrency] } : null);
  } catch {
    finance.setDisplayConfig(null); // default EUR — byte-identical
  }
}
```

Calls `render()` once after all boot loads (existing `init()` already calls `render()` at `app.js:1510`).

### Re-render on save

`render()` (`app.js:1334-1342`) already recomposes all views (table, summary, dashboard, budgets, trend chart, recurring, charts) from `entries`; calling it after `setDisplayConfig` refreshes every display site. No per-view re-render plumbing needed.

### Base-input EUR affordance

The `#amount` input (index.html:51) has no glyph today. Per closed decision 4, input is always EUR: wrap `#amount` in an `input-group` with a static `<span class="input-group-text">€</span>` label so the EUR-base intent is visible even when the display currency differs. The `€` glyph stays hardcoded here (base is fixed EUR, never changes). Budget/recurring input glyphs at `app.js:1150` and `app.js:1261` are likewise **base-EUR input** fields (budgets store base values, recurring stores base values) — they also stay as `€`.

## Excel (`app.js`)

- **Rows stay raw base**: `'Monto': Number(e.monto)` (`app.js:1374`, export) and `monto: Number(row.Monto || ...)` (`app.js:1449`, import) are **unchanged**. Values written/read in notebook are base EUR (closed decision 4, spec Excel NFR).
- **Totals line** (`app.js:1385`): the Description cell currently uses `formatAmount(...)` for all three totals. This is the one place where display conversion is desired in the totals row, but with the **asymmetry** required by the spec:
  - Per spec "Excel export… only the totals line is labeled in the display currency": convert the three totals (`totalIncome/totalExpenses/totalSavings`) to `fmt(...)` (display currency) in the Description text.
  - The **`Monto` column** for the totals row stays raw base `totals.balance` (a plain number, `app.js:1386`) — does NOT get converted or formatted, preserving numeric consistency with the raw row values (all rows are base EUR numbers). The display-currency conversion appears **only in the Description label**, never in the numeric cells. This is the precise asymmetry: *rows and the totals number cell = base EUR; totals Description label = display currency*.

## Testing Strategy

### `src/finance.test.js` (`finance.test.js:41-60`)
- **Keep existing 4 back-compat tests unchanged** (they must pass with the default path — byte-identical).
- New:
  - `convertAmount(1500, 1.1)` → `1650`; `convertAmount(1500, 0)` / `-1` / `NaN` → `1500` (passthrough).
  - `formatAmount(1500, {currency:'USD', rate:1.1})` → `$1,650.00` (en-US).
  - `formatAmount(1650, {currency:'JPY', rate:1})` → `￥1,650` (full-width `￥` U+FFE5, no `.00`).
  - Default/back-compat: `finance.setDisplayConfig(null)` then `formatAmount(1500)` → `€1500,00`; `formatAmount(0)` → `€0,00`; `formatAmount('500')` → `€500,00`.
  - Cache: `setDisplayConfig({displayCurrency:'USD', rate:1.1})` then `formatAmount(1500)` → `$1,650.00`; reset with `setDisplayConfig(null)`.

### `src/storage.test.js`
- Settings round-trip (save then load, `id==='active'`, `updatedAt` number) — mirror aiSettings round-trip (`storage.test.js:184-193`).
- localStorage fallback when `globalThis.indexedDB = undefined` — mirror `storage.test.js:195-212` with key `finanzas:settings:v1`.
- DB v6 store presence: after `openDB()`, `db.objectStoreNames.contains('settings')`.

## Migration Strategy (v5 → v6)

**Additive, zero data loss.** Existing stores (`entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`) untouched; IndexedDB runs only the one new step:

1. Bump `DB_VERSION` 5 → 6 in `src/storage.js`.
2. In `openDB()` `onupgradeneeded`, add `settings` store with `keyPath:'id'` (guarded by `contains()`).
3. No localStorage migration — currency settings are a new data domain.

**Rollback**: revert `DB_VERSION` to 5 and remove the `settings` store creation block; existing stores and data are unaffected. Currency settings are display-only — removing the store only loses display preferences, never entry data.

## Backward Compatibility

- No settings record ⇒ `getActiveFormat()` returns EUR/es-ES/rate 1 ⇒ every `fmt(n)` output is byte-identical to the legacy `formatAmount(n)`.
- AI-prompt and Excel row paths keep base EUR; only the totals Description label converts.
- Existing `formatAmount` tests and all 148 tests must continue to pass unchanged.

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| `loadCurrencySettings()` IDB failure | localStorage fallback; if both fail, `setDisplayConfig(null)` silently (default EUR) |
| `saveCurrencySettings()` IDB failure | localStorage fallback; toast success (user unaware of storage layer) |
| Invalid rate (≤ 0) in modal | Error toast, no persist, modal stays open for correction |
| Unknown `displayCurrency` code | Normalized to EUR by `setDisplayConfig` |
| Corrupt localStorage settings JSON | `lsLoadSettings()` returns null → default EUR |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Fully offline/local; no network requests for conversion or settings.

## Open Questions

- [x] RESOLVED during implementation: `Intl.NumberFormat('es-ES', {style:'currency', currency:'EUR'})` emits `1500,00 €` (trailing glyph, narrow space) in this environment, while the legacy `'€' + toLocaleString('es-ES')` builder emits `€1500,00` — the outputs differ, so the default-EUR branch is pinned to the legacy builder (see the format-strategy notes above; shipped in `src/finance.js:117-124`).
