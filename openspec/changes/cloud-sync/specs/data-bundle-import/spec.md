# Data Bundle Import

## Purpose

Validated import of a `.fpkg` bundle into IndexedDB, overwriting existing stores with raw encrypted envelopes and optionally verifying decrypt integrity.

## Requirements

### Requirement: Bundle Validation

The system MUST validate the bundle before any write occurs. Validation MUST check: (a) `bundle` is a non-null object, (b) `bundle.version === 1`, (c) `bundle.stores` exists and is an object, (d) `bundle.cryptoMeta` is present (not null/undefined).

#### Scenario: Valid bundle accepted

- GIVEN a bundle with `{ version: 1, stores: {...}, cryptoMeta: {...} }`
- WHEN `importAll(bundle)` is called
- THEN validation passes and import proceeds

#### Scenario: Missing version field

- GIVEN a bundle with `{ stores: {...} }` and no `version` key
- WHEN `importAll(bundle)` is called
- THEN returns `{ ok: false, errors: ["Invalid bundle: missing version"] }` and no stores are written

#### Scenario: Wrong version number

- GIVEN a bundle with `{ version: 2, stores: {...} }`
- WHEN `importAll(bundle)` is called
- THEN returns `{ ok: false, errors: ["Unsupported bundle version: 2"] }` and no stores are written

#### Scenario: Missing stores key

- GIVEN a bundle with `{ version: 1, cryptoMeta: {...} }` and no `stores`
- WHEN `importAll(bundle)` is called
- THEN returns `{ ok: false, errors: ["Invalid bundle: missing stores"] }` and no stores are written

#### Scenario: Missing cryptoMeta

- GIVEN a bundle with `{ version: 1, stores: {...} }` and `cryptoMeta` is `null`
- WHEN `importAll(bundle)` is called
- THEN returns `{ ok: false, errors: ["Invalid bundle: missing cryptoMeta"] }` and no stores are written

#### Scenario: null/undefined input

- GIVEN `importAll(null)` is called
- WHEN `importAll(null)` is called
- THEN returns `{ ok: false, errors: ["Invalid bundle: not an object"] }` and no stores are written

### Requirement: Store Overwrite

The system MUST overwrite each data store's contents with the records from `bundle.stores`. Each store MUST be cleared before writing the imported records. The `cryptoMeta` store MUST be overwritten with `bundle.cryptoMeta`.

#### Scenario: All stores overwritten

- GIVEN IDB has existing data in all 6 stores + cryptoMeta
- WHEN a valid bundle is imported
- THEN each store's previous contents are replaced with the bundle's records

#### Scenario: Partial store bundle

- GIVEN a bundle with only `entries` and `budgets` in `stores` (other keys missing)
- WHEN the bundle is imported
- THEN `entries` and `budgets` are overwritten; other stores are left untouched

#### Scenario: Empty store in bundle

- GIVEN a bundle with `stores.recurring` as `null` or empty array
- WHEN the bundle is imported
- THEN the `recurring` store is cleared (emptied) rather than left with old data

### Requirement: Envelope Integrity Check

The system SHOULD verify that each store's record is a valid envelope before writing. A valid envelope has `{ v, alg, salt, iv, ct }` (or `{ id: 'active', v, alg, salt, iv, ct }` for `aiSettings`/`currency`).

#### Scenario: Valid envelope per store

- GIVEN each store record has the expected envelope fields
- WHEN import writes to a store
- THEN the record is written without error

#### Scenario: Corrupted envelope detected

- GIVEN `stores.entries` contains `{ id: '__enc__', v: 1 }` (missing `alg`, `salt`, `iv`, `ct`)
- WHEN `importAll()` validates before write
- THEN the entries store is skipped, other stores are still written, and `errors[]` includes `"entries: invalid envelope format"`

### Requirement: Decrypt Round-Trip Verification

The system SHOULD optionally verify that imported data can be decrypted with the current passphrase. This is a post-import check, not a pre-write gate.

#### Scenario: Round-trip succeeds

- GIVEN import completed successfully with `cryptoMeta` written
- WHEN the app re-initializes crypto with the current passphrase
- THEN `initKey(passphrase, importedCryptoMeta)` succeeds and all stores decrypt

#### Scenario: Round-trip fails with wrong passphrase

- GIVEN bundle was exported with passphrase "A" and import runs on device with passphrase "B"
- WHEN import completes and app re-init runs `initKey("B", bundle.cryptoMeta)`
- THEN key derivation fails; app shows decryption error on next load

### Requirement: Atomicity

The system MUST write all stores in a single IDB transaction. If any store write fails, the entire transaction MUST be rolled back and no stores are modified.

#### Scenario: Transaction commit

- GIVEN valid bundle with all stores
- WHEN `importAll()` writes to IDB
- THEN all stores are committed atomically

#### Scenario: Transaction rollback on failure

- GIVEN a bundle where `stores.budgets` is corrupt and causes an IDB write error
- WHEN `importAll()` attempts the transaction
- THEN the transaction rolls back, no stores are modified, and `errors[]` includes the budgets failure

## Interface

```js
/**
 * Validates and imports a .fpkg bundle, overwriting IDB stores.
 * @param {Object} bundle - The parsed .fpkg JSON object
 * @returns {Promise<{ok: boolean, errors: string[]}>}
 *   ok=true means all stores were written successfully.
 *   ok=false means validation failed or a write error occurred; errors[] explains.
 */
importAll(bundle) → Promise<{ok: boolean, errors: string[]}>
```

**Errors**: Never throws. Returns `{ ok: false, errors: [...] }` for all failure modes. The `errors` array contains human-readable strings identifying each failure.

## Dependencies

- IndexedDB stores: `entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`, `currency`, `cryptoMeta`
- `DB_VERSION` constant for IDB open

## Implementation Notes

- Validation is pre-transaction: check all fields before opening the write transaction.
- Write all stores in ONE `IDBTransaction` with `readwrite` mode on all object stores.
- `cryptoMeta` must be written last (or atomically with the rest) to avoid partial state.
- Do NOT decrypt during import — raw blobs are stored as-is. Decryption happens on next `load()`.
- The `partial store bundle` scenario means missing keys in `stores` are treated as "leave untouched", NOT as "clear". Only keys explicitly present in `stores` are overwritten.
