# Data Bundle Export

## Purpose

Portable export of all encrypted IndexedDB stores plus crypto key material as a single `.fpkg` JSON file, enabling cross-device data transfer.

## Requirements

### Requirement: Raw Envelope Read

The system MUST read raw encrypted envelope records from all 6 data stores (`entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`, `currency`) plus the `cryptoMeta` store from IndexedDB.

#### Scenario: All stores populated

- GIVEN IDB contains encrypted records in all 7 stores
- WHEN `exportAll()` is called
- THEN the returned object contains keys for all 7 stores with their raw envelope data

#### Scenario: Some stores empty

- GIVEN IDB has entries but empty budgets/recurring/customCategories
- WHEN `exportAll()` is called
- THEN empty stores return `null` or empty array and non-empty stores return their envelope records

#### Scenario: All stores empty

- GIVEN IDB is freshly initialized with no user data
- WHEN `exportAll()` is called
- THEN all store keys in the bundle have `null`/empty values and no error is thrown

#### Scenario: cryptoMeta absent

- GIVEN `cryptoMeta` store is empty (no passphrase set)
- WHEN `exportAll()` is called
- THEN `bundle.cryptoMeta` is `null` and export succeeds

### Requirement: Bundle Envelope Structure

The system MUST return a plain JavaScript object with this shape: `{ version: 1, dbVersion: <number>, timestamp: <ISO string>, cryptoMeta: <envelope or null>, stores: { entries, budgets, recurring, customCategories, aiSettings, currency } }`.

#### Scenario: Version field is constant

- GIVEN any state
- WHEN `exportAll()` is called
- THEN `bundle.version` is always `1`

#### Scenario: DB_VERSION included

- GIVEN `DB_VERSION` is `7` in storage.js
- WHEN `exportAll()` is called
- THEN `bundle.dbVersion` equals `7`

#### Scenario: Timestamp is ISO 8601

- GIVEN any state
- WHEN `exportAll()` is called
- THEN `bundle.timestamp` is a valid ISO 8601 string parseable by `new Date()`

#### Scenario: cryptoMeta passthrough

- GIVEN `cryptoMeta` store contains `{ v:1, alg, iterations, salt, wrappedDek }`
- WHEN `exportAll()` is called
- THEN `bundle.cryptoMeta` is the same object (not a re-serialization that loses fields)

#### Scenario: Store envelope format preserved

- GIVEN each data store has a single envelope record (e.g. `{ id: '__enc__', v:1, alg, salt, iv, ct }`)
- WHEN `exportAll()` is called
- THEN each `bundle.stores.<name>` is the raw record(s) from that store, unmodified

### Requirement: Asynchronous Read

The system MUST perform all IDB reads asynchronously and return a Promise that resolves to the bundle object.

#### Scenario: Promise resolution

- GIVEN any state
- WHEN `exportAll()` is called
- THEN returns a `Promise<Object>` that resolves with the bundle

#### Scenario: IDB connection reopened

- GIVEN DB connection was closed by prior operation
- WHEN `exportAll()` is called
- THEN opens DB internally, reads all stores, and resolves successfully

## Interface

```js
/**
 * Reads all raw encrypted envelopes from IDB stores + cryptoMeta.
 * @returns {Promise<{version:1, dbVersion:number, timestamp:string, cryptoMeta:Object|null, stores:Object}>}
 */
exportAll() → Promise<BundleObject>
```

**Errors**: Rejects if IDB cannot be opened or a read transaction fails. The rejection message MUST include which store failed.

## Dependencies

- IndexedDB stores: `entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`, `currency`, `cryptoMeta`
- `DB_VERSION` constant from `src/storage.js`

## Implementation Notes

- Each store has ONE envelope record (envelope-per-store pattern). Read via `getAll()`.
- `cryptoMeta` is a single record. Read via `getAll()` and take first element.
- No decryption occurs — raw blobs pass through as-is.
- The `.fpkg` extension is a convention; the file content is `JSON.stringify(bundle)`.
