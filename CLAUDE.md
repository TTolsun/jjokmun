# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the repository guidelines (file roles, coding style, commit conventions). Read it first; this file adds commands and the cross-file architecture.

## What this is

jjokmun is an offline Chrome Manifest V3 extension for memos, replies, and a small pixel-art pet garden. There is no build step, bundler, linter, or formatter: Chrome loads `extension/` directly as browser ES modules. Load it via `chrome://extensions` → Developer mode → Load unpacked → `extension/`. After edits, close jjokmun tabs, reload the extension card, then click the toolbar icon.

User-facing strings are Korean. Commit subjects are short Korean summaries.

## Commands

Node.js 24, run from `tests/`:

```powershell
cd tests
npm install                            # playwright-core
npx playwright-core install chromium   # or set MEMO_CHROME_PATH to an existing Chrome for Testing
npm test                               # node verify.cjs
```

- There is no per-test runner. `verify.cjs` runs the browser scenarios and calls other test modules from its `run()`. To focus on one area, call a module's exported `check*` function from a scratch script.
- `undo.cjs` imports `store.js`/`imports.js` straight into Node (no browser), so pure-logic checks for merge/undo can live there.
- `browser.cjs` prefers a sibling `../jjokmun` directory with a `manifest.json` over `../extension` when one exists.
- Tests launch headless Chromium with a temp profile (`ko-KR`, `Asia/Seoul`) and fail if any HTTP(S)/WS request leaves the extension. The suite also asserts the manifest has no `permissions`, `host_permissions`, or `chrome_url_overrides`; keep it that way.
- Tests stub `window.showDirectoryPicker` to return an OPFS directory (`selectFolder` in `browser.cjs`). Pass `?date=YYYY-MM-DD` to `index.html` to fake "today" (`app.js` honors it).

## Architecture

### Persistence layers

```
app.js / ui/*.js
   │  transact(change) / readPayload(change)
   ▼
vault.js   ── record format 2, revision/epoch CAS, encryption session, Web Locks
   │  readVaultFile / writeVaultFile
   ▼
folder.js  ── jjokmun-vault.json in the user-selected directory (File System Access API)
```

- **State model (`store.js`)**: `{ version: 1, memos, daily, props, pet?, shop?, business? }`. The last two fields preserve earlier bookshop records. `validateBackup` validates imported backups and plain vault state (`{ local: true }` lifts size caps). `selectDaily` deterministically picks the day's resurfaced memo (least recently shown, older than today).
- **Vault record (`vault.js`)**: `{ format: 2, revision, epoch, mode: 'plain'|'encrypted', payload | salt/iv/ciphertext }`. `payload` contains `state`, the import-undo journal in `undo`, and optional document links. `readVaultFile()` rejects any vault file without `format: 2`; `normalize()` wraps the bare state read from the legacy IndexedDB profile during migration (or an empty state when there is none).
- **Concurrency**: every read/write goes through `navigator.locks` (`jjokmun-storage`). Writes are optimistic: `readPayload` re-reads, applies `change`, and saves only if `revision` is unchanged, retrying up to `MAX_WRITE_ATTEMPTS`. `change` may run more than once, so it must be a pure mutation of the state it receives; return `false` to skip saving.
- **Locking**: `epoch` bumps on encrypt/decrypt/lock. A tab's in-memory `session` (derived key) is valid only for the matching `epoch` and folder; any mismatch throws `LockedError`. The module-level `generation` counter invalidates in-flight work after a lock or folder switch.
- **Directory handle** for the last selection is stored in a separate IndexedDB database (`jjokmun-folders`). New tabs and reloads reopen its existing vault when permission allows. Each tab keeps its own active connection. `useFolder` either opens an existing `jjokmun-vault.json` or creates one, and on first creation migrates the legacy IndexedDB `memo-alley` profile (`legacy-profile.js`). The written file is re-read and compared only when the legacy profile had a `state` record; `removeMigratedProfile` then aborts if that record changed, otherwise clears the `data` store and deletes the database. A legacy database with no `state` record is deleted without a file comparison, so do not store anything else in it.

### Multi-tab sync

`app.js` uses `BroadcastChannel('memo-alley')`. After a write it posts `{ type, directory }`; receivers compare handles with `isSameEntry` and `refresh()`. A `security` message drops the key and clears the UI. A 5 s interval also polls `vaultStatus()` for date rollover and lock changes. `clearSensitive()` is the one place that wipes rendered memo content; extend it when adding views that show memo text.

### Backups and imports

`crypto.js` (PBKDF2 + AES-GCM via WebCrypto) seals both the encrypted vault and exported backups; the `purpose` argument (`'vault'` vs `'backup'`) is bound into the AES-GCM additional data (`memo-alley:<purpose>:1:<salt>`) and sets the size limit, so a ciphertext of one kind cannot be opened as the other. Backup envelope format name is `memo-alley-encrypted`; keep accepting older backups. `imports.js` `mergeImport` returns a summary plus an undo journal stored in `payload.undo`; `undoImport` reverses it only where data is unchanged since import.

### Pet garden

`pet.js` defines the care actions, elapsed-time updates, habit-based growth, and collection. `ui/pet.js` renders the garden and saves elapsed-time growth when the garden first shows the new form. Ordinary display updates calculate status from the last saved record. Backups include the pet and its collection. The bookshop validators in `shop.js` and `business.js` keep older records readable.

### Security constraints

The manifest CSP is `default-src 'none'` with `connect-src 'none'`: no inline scripts/styles, no network, no remote assets. Render user text with DOM APIs (`textContent`), never `innerHTML`.

## Compatibility checklist

When changing persistence, keep working: legacy `memo-alley` IndexedDB migration, older JSON/encrypted backups, vault files written by earlier versions (format 2 record, optional `memo.createdAt`, optional `shop`), and multi-tab locking. Add regression coverage in `tests/` with synthetic memos.
