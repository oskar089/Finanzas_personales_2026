# Tasks: Cloud Sync Phase 1 — Manual .fpkg File Sync

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~430 (core: ~200, tests: ~230) |
| 400-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | exportAll() + importAll() in storage.js | PR 1 | `npx vitest run src/storage.test.js` | fake-indexeddb round-trip in vitest jsdom | Revert storage.js additions + storage.test.js new tests |
| 2 | cloud-sync.js + UI in index.html/app.js | PR 2 | `npx vitest run src/cloud-sync.test.js` | fake-indexeddb + DOM events in vitest jsdom | Remove cloud-sync.js, revert index.html/app.js |

## Phase 1: Foundation — exportAll()

- [x] 1.1 RED: Write failing tests for exportAll() in `src/storage.test.js` — scenarios 1-11 (all stores populated, some empty, all empty, cryptoMeta absent, version constant, dbVersion, timestamp ISO, cryptoMeta passthrough, store format preserved, promise returns, IDB reopened)
- [x] 1.2 GREEN: Implement `exportAll()` in `src/storage.js` — async function, reads all 7 stores via `rawGetAll`, assembles `{ version: 1, dbVersion: DB_VERSION, timestamp: new Date().toISOString(), cryptoMeta, stores: {...} }`, returns Promise
- [x] 1.3 REFACTOR: Verify exportAll tests pass, clean up any duplication with existing storage test helpers

## Phase 2: Core — importAll()

- [x] 2.1 RED: Write failing tests for importAll() in `src/storage.test.js` — scenarios 1-15 (valid bundle, missing version, wrong version, missing stores, missing cryptoMeta, null input, all stores overwritten, partial bundle, empty store in bundle, valid envelope check, corrupted envelope skip, round-trip decrypt, wrong passphrase, atomic commit, atomic rollback)
- [x] 2.2 GREEN: Implement `importAll(bundle)` in `src/storage.js` — validation (null check, version===1, stores present, cryptoMeta present), single IDB readwrite transaction, clear+write per store from bundle, envelope integrity check per record (skip corrupted), error logging, returns `{ ok: boolean, errors: string[] }`
- [x] 2.3 GREEN: Add localStorage mirror sync after successful IDB write — call existing localStorage sync helpers for each store
- [x] 2.4 REFACTOR: Verify importAll tests pass, extract shared envelope validation helper if useful

## Phase 3: Orchestration — cloud-sync.js

- [x] 3.1 RED: Write failing tests in `src/cloud-sync.test.js` — scenarios: export triggers download (Blob + createObjectURL), file naming (`finanzas-backup-YYYY-MM-DD.fpkg`), file picker opens, cancel file picker, parse error, validation error propagation
- [x] 3.2 GREEN: Create `src/cloud-sync.js` — `downloadPackage()` (calls exportAll, creates Blob, triggers `<a>` download), `uploadPackage(file)` (reads File, JSON.parse, validates, calls importAll)
- [x] 3.3 GREEN: Export functions from `src/cloud-sync.js`: `downloadPackage`, `uploadPackage`
- [x] 3.4 REFACTOR: Verify cloud-sync tests pass

## Phase 4: UI Integration

- [x] 4.1 RED: Write failing tests for UI logic — button enable/disable based on `hasEncryptionKey()`, export triggers downloadPackage, import triggers file picker flow, confirmation modal shows timestamp + warning, confirm calls importAll + reload, cancel closes modal
- [x] 4.2 GREEN: Add UI elements to `index.html` — Export/Import buttons (near Excel export), hidden `<input type="file" accept=".fpkg">`, Bootstrap modal for import confirmation (timestamp + dbVersion + overwrite warning)
- [x] 4.3 GREEN: Add handlers in `app.js` — exportFlow (calls downloadPackage), importFlow (file picker → parse → validate → show modal → confirm → importAll → reload), button enable/disable on init based on `hasEncryptionKey()`
- [x] 4.4 REFACTOR: Verify all tests pass — `npx vitest run` full suite

## DoD (Definition of Done)

- [ ] exportAll() generates versioned bundle with all 7 stores + cryptoMeta
- [ ] importAll() validates bundle, rehydrates stores atomically, syncs localStorage mirrors
- [ ] UI: Export/Import buttons functional with confirmation before import
- [ ] Tests cover all 39 spec scenarios (export: 11, import: 15, UI: 13)
- [ ] `npx vitest run` passes — 235 existing + new tests
- [ ] No existing tests broken
- [ ] Bundle format: `{ version: 1, dbVersion, timestamp, cryptoMeta, stores }`

## Files Affected

| File | Action | Scope |
|------|--------|-------|
| `src/storage.js` | Modified | +~90 lines: exportAll() (~30), importAll() (~60) |
| `src/storage.test.js` | Modified | +~150 lines: 26 new test scenarios |
| `src/cloud-sync.js` | New | ~70 lines: downloadPackage, uploadPackage |
| `src/cloud-sync.test.js` | New | ~80 lines: 13 test scenarios |
| `index.html` | Modified | ~30 lines: buttons + modal + file input |
| `app.js` | Modified | ~10 lines: event handlers + enable/disable |

## Implementation Order

1. **PR 1 (Core)**: Phase 1 + Phase 2 — exportAll/importAll in storage.js with tests. Autonomous, no UI dependency. Focused test: `npx vitest run src/storage.test.js`.
2. **PR 2 (UI)**: Phase 3 + Phase 4 — cloud-sync.js + index.html + app.js. Depends on PR 1. Focused test: `npx vitest run src/cloud-sync.test.js`.
