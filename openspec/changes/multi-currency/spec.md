# Currency Settings Specification

## Purpose

Multi-currency display support: a global display currency (EUR fixed as base, USD/GBP/ARS/MXN/BRL/JPY and optionally CHF as display choices), a manual exchange rate per display currency, real base→display conversion applied at the render boundary (stored values remain in EUR), and a new "⚙️ Ajustes" settings modal in the navbar. Replaces the hardcoded EUR glyph and format with a parameterized number-formatting layer, with full backward compatibility when no settings are configured.

## Requirements

### Requirement: Currency Settings Persistence

The system MUST persist the chosen display currency and its manual exchange rate in IndexedDB `settings` store (keyPath `'id'`, single `'active'` record) with a localStorage mirror, following the existing `aiSettings` persistence pattern. Settings MUST survive page reloads and browser restarts.

#### Scenario: Save display currency and rate

- GIVEN the settings modal is open and the user has selected USD with a rate of 1.1
- WHEN the user clicks Save
- THEN the settings are persisted to the IndexedDB `settings` store under the `'active'` key AND to the localStorage mirror
- AND subsequent renders apply USD as the display currency with the saved rate

#### Scenario: Reload restores saved currency

- GIVEN the user previously saved USD as the display currency with a rate
- WHEN the page is reloaded
- THEN the boot sequence loads the settings from IndexedDB `settings` (falling back to the localStorage mirror)
- AND all views render in the saved USD display currency

#### Scenario: localStorage fallback

- GIVEN IndexedDB is unavailable or corrupted
- WHEN the system loads currency settings
- THEN it reads the settings from the localStorage mirror key
- AND the saved display currency and rate remain active

#### Scenario: Additive DB migration from v5 to v6

- GIVEN an existing database at version 5 containing `entries`, `budgets`, `recurring`, `customCategories`, and `aiSettings` stores
- WHEN the database is upgraded to version 6
- THEN a new `settings` store is created with `keyPath: 'id'`
- AND all existing stores and their records are preserved with zero data loss

### Requirement: Fixed Base EUR and Backward Compatibility

The stored amount of every entry MUST remain in EUR and MUST never be rewritten when the display currency changes. When no settings are configured, all output MUST be byte-identical to the current EUR formatting.

#### Scenario: No settings keep returning EUR

- GIVEN no currency settings have been saved
- WHEN any view or export renders an amount
- THEN the output is byte-identical to the current `€` + `es-ES` formatting (e.g. `€1500,00` for 1500 — the actual legacy output in this environment)
- AND behavior matches the pre-change application

#### Scenario: Changing display never rewrites entries

- GIVEN the user switches the display currency from EUR to USD with a rate
- WHEN the display currency changes
- THEN no stored entry amounts are modified
- AND switching the display currency back to EUR restores the original EUR values across all views

### Requirement: Display Conversion

Amounts MUST be converted from the base (EUR) to the display currency before display, using the saved manual rate for the active display currency, then formatted with the display currency's locale. Aggregations are computed on the raw base (`e.monto`) values; totals are converted from base once as a single unit at the display boundary.

#### Scenario: Convert and format across views

- GIVEN the display currency is USD with rate 1.1 and an entry amount of EUR 1500
- WHEN the entry is rendered in any view (list, dashboard, budget progress, recurring, Excel totals line)
- THEN the displayed amount is USD 1650 formatted with the `en-US` locale
- AND each of the `formatAmount` call sites throughout `app.js` reflects the converted value

#### Scenario: Totals converted once from base

- GIVEN the display currency is USD with rate 1.1
- WHEN a dashboard total (e.g. total income, expenses, or balance) is rendered
- THEN the total is computed from raw base `e.monto` values in EUR first
- AND the resulting base total is converted once to the display currency
- AND the displayed total may differ by minor rounding cents versus the sum of individually converted rows

#### Scenario: Aggregations stay on raw base

- GIVEN the display currency is not EUR
- WHEN category breakdowns, comparisons, budgets, or projection values are computed
- THEN the underlying aggregations are computed from unmodified base EUR `e.monto` values
- AND conversion is applied only at the display (formatting) boundary

### Requirement: Manual Exchange Rate Editing

The user MUST be able to enter or update the exchange rate for the selected display currency (1 EUR = X in display currency) in the settings modal. The rate MUST be greater than 0, and MUST be validated with a clear success or error message.

#### Scenario: Enter a valid rate

- GIVEN the settings modal is open and the display currency is USD
- WHEN the user enters a rate of 1.1
- AND clicks Save
- THEN the settings are persisted
- AND a success toast is shown
- AND subsequent renders convert EUR to USD using 1.1

#### Scenario: Update an existing rate

- GIVEN the user previously saved USD with a rate of 1.1
- WHEN the user reopens the settings modal
- AND the rate field is pre-filled with the previously saved value (1.1)
- THEN the user can change it
- AND saving the new rate updates the persisted rate and all future renders

#### Scenario: Reject an invalid rate

- GIVEN the settings modal is open
- WHEN the user enters a rate of 0 or a negative value (e.g. -1)
- AND clicks Save
- THEN the save is rejected with an error message indicating the rate must be greater than 0
- AND no settings are persisted
- AND the modal remains open for correction

### Requirement: Input Remains in Base (EUR)

The transaction input field MUST always be in EUR. The input field glyph MUST show EUR even when the display currency differs, typed amounts are stored as-is in EUR, and conversion happens only at render time.

#### Scenario: Input field shows EUR regardless of display currency

- GIVEN the display currency is USD and the display shows amounts in USD
- WHEN the user opens the transaction input form
- THEN the input group glyph shows EUR
- AND the user is expected to enter the amount in EUR

#### Scenario: Typed amounts stored as-is

- GIVEN the display currency is USD
- WHEN the user types 1500 in the EUR input and saves the transaction
- THEN the stored `monto` is 1500 (EUR) unchanged
- AND the stored value is never converted to or rewritten as a display-currency amount

#### Scenario: Conversion only at render

- GIVEN a stored entry of EUR 1500 and display currency USD with rate 1.1
- WHEN the entry is rendered
- THEN the stored value remains 1500 in the data model and persistence layer
- AND the displayed value is converted at render time only

### Requirement: Settings Modal UX

A new "⚙️ Ajustes" button MUST be present in the navbar, opening a Settings modal that provides a curated currency catalog selector and a manual rate input. The existing AI settings modal MUST remain intact. Closing or canceling the modal without saving MUST discard any unsaved changes.

#### Scenario: Open the Settings modal from the navbar

- GIVEN the app is loaded and the user is authenticated
- WHEN the user clicks the "⚙️ Ajustes" navbar button
- THEN the Settings modal opens
- AND the currency selector shows the curated catalog: EUR, USD, GBP, ARS, MXN, BRL, JPY (and CHF when opted in)
- AND the default selection is EUR with no rate required

#### Scenario: Curated currency catalog

- GIVEN the Settings modal is open
- WHEN the user expands the currency selector
- THEN the available options are limited to the curated catalog
- AND each currency maps to its Intl locale (EUR→es-ES, USD→en-US, GBP→en-GB, ARS→es-AR, MXN→es-MX, BRL→pt-BR, JPY→ja-JP, CHF→de-CH)

#### Scenario: AI settings modal remains intact

- GIVEN the app is loaded
- WHEN the user clicks the existing "⚙️ IA" navbar button
- THEN the AI settings modal opens as before, unchanged
- AND the new Settings modal does not alter AI settings behavior or persistence

#### Scenario: Close or cancel without saving

- GIVEN the Settings modal is open with unsaved currency or rate changes
- WHEN the user clicks Cancel or the modal backdrop
- THEN no settings are persisted
- AND the modal closes
- AND the previously active display currency and rate remain in effect

### Requirement: Non-Functional

The conversion and settings features MUST remain fully offline and local, the migration MUST be additive with zero data loss, and the settings modal MUST be responsive on mobile viewports.

#### Scenario: Offline and local operation

- GIVEN the app is opened without network access
- WHEN the user changes the display currency and rate, or renders converted amounts
- THEN no network requests are made
- AND the conversion relies only on the locally saved manual rate

#### Scenario: Mobile responsive settings modal

- GIVEN the user opens the Settings modal on a mobile viewport
- WHEN the modal renders the currency selector and rate input
- THEN the controls are usable and fit the viewport without horizontal scrolling

#### Scenario: Aggregated toasts and re-render

- GIVEN a display currency or rate change is saved
- WHEN the save completes
- THEN all views re-render with the new display currency
- AND the result is confirmed with a success toast

## Non-Functional Requirements

- EUR MUST remain the fixed base currency: stored entry values are always EUR and are never rewritten by a display currency change
- Conversion MUST be applied at the display boundary only; data model, persistence, and AI-prompt amounts remain in base EUR
- The `formatAmount` layer MUST remain backward compatible, defaulting to `€` + `es-ES` output when no currency settings are configured
- The DB migration from v5 to v6 MUST be additive only (new `settings` store) with zero data loss on existing stores
- Manual rate entries MUST be validated to be greater than 0; no live exchange-rate fetch or API keys may be introduced
- All features MUST operate offline/local with no network dependency for conversion or settings
- The Settings modal MUST be responsive and functional on mobile viewports
- The existing AI settings modal and its persistence MUST remain unchanged
- Excel export and import MUST keep amounts as raw base EUR; only the totals line is labeled in the display currency

## Out of Scope

- Per-entry currency selection (a single global display currency applies to all entries)
- Live/automatic exchange-rate fetching or API keys
- Rewriting or storing entries in any currency other than base EUR
- A currency column or per-row conversion in the Excel export/import in v1
- Per-currency historical rate records or exchange-rate history
