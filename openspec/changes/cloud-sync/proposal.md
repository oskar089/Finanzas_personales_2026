# Proposal: Cloud Sync

## Intent

User data lives in a single browser's IndexedDB. Changing devices or clearing storage loses everything. The encryption envelope is already portable (`crypto.test.js` proves cross-device decryption works), but there is no mechanism to move the data between devices. This change adds a manual `.fpkg` file sync as Phase 1 foundation.

## Scope

### In Scope
- `exportAll()` in `src/storage.js` — reads raw encrypted envelopes from all stores + cryptoMeta
- `importAll(bundle)` in `src/storage.js` — validates, writes raw envelopes, triggers reload
- `.fpkg` bundle format: `{ version, stores: { entries, budgets, recurring, customCategories, aiSettings, settings }, cryptoMeta }`
- `src/cloud-sync.js` — download/upload orchestration (file picker, download trigger)
- UI buttons in `index.html` near existing Excel export
- Round-trip tests via `fake-indexeddb`

### Out of Scope
- OneDrive auto-sync via MSAL SDK
- Google Drive sync
- Conflict resolution / merge logic
- Real-time background sync

## Capabilities

### New Capabilities
- `data-bundle-export`: Portable export of all encrypted stores as a single `.fpkg` JSON file
- `data-bundle-import`: Validated import of `.fpkg` bundle with store overwrite and optional decrypt verification
- `cloud-sync-ui`: Export/Import buttons and confirmation flow in the settings view

### Modified Capabilities
- None — `crypto.js` and `storage.js` public API are unchanged; new functions are additive

## Approach

Manual `.fpkg` file sync. `exportAll()` reads all raw envelope records from IDB stores + `cryptoMeta`, serializes into versioned JSON. `importAll()` validates bundle version, checks `isEnvelope()` per store, writes raw envelopes, optionally round-trips decrypt to verify integrity. UI provides export (triggers browser download) and import (file picker → `importAll()` → reload). Passphrase gate (`cryptoGate`) runs before any sync operation.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/storage.js` | Modified | Add `exportAll()` and `importAll(bundle)` functions |
| `src/cloud-sync.js` | New | Download/upload orchestration, file picker, download trigger |
| `index.html` | Modified | Export/Import buttons near Excel export section |
| `src/crypto.js` | None | Already portable; no changes needed |
| `app.js` | None | No changes to init flow |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bundle size with years of entries (>5MB) | Low | Size check + user warning before export |
| Import overwrites all stores | Medium | Confirmation dialog with timestamp display |
| Version migration when DB_VERSION bumps | Low | Version field in bundle; `importAll()` checks version |
| `cryptoMeta` absent in bundle breaks key derivation | Low | Validate cryptoMeta presence + decrypt round-trip on import |

## Rollback Plan

Entirely additive — new functions and UI buttons. Rollback: hide UI buttons, remove `cloud-sync.js`, revert `storage.js` additions. No existing data flow or API changes to undo.

## Dependencies

- `fake-indexeddb` (already in devDependencies) for round-trip tests
- No external libraries, CDNs, or OAuth registrations required

## Success Criteria

- [ ] `exportAll()` returns all 6 stores + cryptoMeta as a versioned JSON object
- [ ] `importAll()` overwrites stores and optional decrypt round-trip passes
- [ ] Cross-browser round-trip test: export on Chrome → import on Firefox → decrypt with passphrase
- [ ] `.fpkg` file for typical dataset (<5 years entries) stays under 100KB
- [ ] Import shows confirmation dialog and reloads app after success
