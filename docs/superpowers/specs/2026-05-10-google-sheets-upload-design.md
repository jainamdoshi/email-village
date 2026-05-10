# Google Sheets Upload — Design

## Goal

Replace local bounced-email CSVs with a single shared Google Sheet in the user's Drive. Both `collect` and `process` commands upload newly-fetched bounced email addresses to one sheet, deduped by email, so the user has one always-up-to-date master list of bounced addresses across runs.

## Scope

- New module `src/sheets/` for Drive folder + Sheets file lifecycle and uploads.
- OAuth scope expansion to include Drive (`drive.file`) and Sheets (`spreadsheets`).
- `collect` command: drops local `bounced-emails.csv` output; uploads to Sheet only.
- `process` command: drops `*_invalid.csv` output; uploads to Sheet only. Still writes the cleaned valid CSV back over the user's input file.
- Documentation updates for Google Cloud setup, usage, and architecture.

Out of scope: managing multiple sheets, custom column choices, sharing settings, alternative folder names, retroactive upload of historical CSVs.

## User-visible Behavior

### Folder and sheet structure

- Folder name: `email village` (root of My Drive).
- Sheet file name: `Bounced Emails`.
- Tab name: `Bounces`.
- Columns: `email | bounce_date | confidence` (header row in row 1).

### `collect` command

- `--output` flag is removed.
- Authenticates, fetches bounces, parses, then uploads new bounces to the Sheet.
- On success: prints `Added N new bounced emails to Google Sheet` (or `No new bounces to add` if dedupe filters everything out).
- Processed-state markers are saved only after a successful upload.

### `process` command

- Continues to overwrite the user's input CSV with valid (non-bounced) rows.
- Stops writing the `*_invalid.csv` file.
- Order of operations: authenticate → fetch bounces → upload to Sheet → write cleaned input CSV → save processed-state.
- If the upload fails, neither the input CSV nor the processed-state is touched, so the next run retries cleanly.

### `auth` command

- Behavior unchanged from the user's perspective, but the consent screen now requests Drive and Sheets scopes alongside Gmail.
- Existing cached tokens (granted only `gmail.readonly`) are detected on first Drive API call and the user is told to re-run `auth`.

### `status` command

- Unchanged.

## OAuth Scopes

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Existing — read bounce messages |
| `https://www.googleapis.com/auth/drive.file` | Create + manage only files this app creates (folder + sheet). App cannot see other Drive content. |
| `https://www.googleapis.com/auth/spreadsheets` | Read existing emails for dedupe and append new rows |

`drive.file` is intentionally narrow: the app cannot read or modify any Drive content it didn't create. This means the folder and sheet must be created by the app — the user cannot pre-create them and expect the app to find them.

## Folder + Sheet Lifecycle

On each run that needs to upload:

1. Read `~/.email-bouncer/sheet-config.json` (mode `0o600`). If it has `folderId` and `sheetId`, verify each via a single `files.get` call.
2. If verification fails (file deleted) or config is missing, search Drive (within `drive.file` scope) for a folder named `email village`.
   - If found, reuse.
   - If not found, create one.
3. Search the folder for a file named `Bounced Emails` of MIME type `application/vnd.google-apps.spreadsheet`.
   - If found, reuse.
   - If not found, create the spreadsheet, rename its first tab to `Bounces`, and write the header row `email | bounce_date | confidence`.
4. Persist resolved IDs to `sheet-config.json`.

Edge case: if the user manually deletes the folder or sheet from Drive, the next run treats them as missing and recreates fresh empty ones. Old data is gone — this is documented behavior.

## Upload Flow (Append + Dedupe)

For each run with bounces in hand:

1. Resolve folder + sheet IDs.
2. Read range `Bounces!A2:A` via `spreadsheets.values.get` (skipping the header row) to build a `Set<string>` of existing emails (already normalized when written).
3. Filter the run's bounce records, keeping only those whose normalized email is not in the existing set.
4. If filtered list is non-empty, append rows via `spreadsheets.values.append` with `valueInputOption: RAW` and `insertDataOption: INSERT_ROWS`.
5. Log the count of newly added rows.

Dedupe key: `normalizeEmail(record.email)` (existing utility, lowercases and trims). Same normalization is used for everything written to the sheet, so case-only differences don't produce duplicates.

## Module Layout

```
src/sheets/
  drive-folder.ts    — findOrCreateFolder(drive, name): Promise<string>
  bounce-sheet.ts    — findOrCreateBounceSheet(sheets, drive, folderId): Promise<string>
                       readExistingEmails(sheets, sheetId): Promise<Set<string>>
                       appendBounceRows(sheets, sheetId, records): Promise<number>
  config-store.ts    — loadSheetConfig(): { folderId, sheetId } | null
                       saveSheetConfig(config): void
  uploader.ts        — uploadBouncesToSheet(auth, records): Promise<{ added: number }>
                       (orchestrates the above; the only entry point used by index.ts)
```

`src/auth/oauth.ts` is updated to:
- Include the new scopes in the `SCOPES` array.
- On success of cached-token verification, also do a lightweight Drive call (e.g., `about.get(fields="user")`) to confirm the cached token has the new scopes. If it returns an insufficient-scope error, clear the cached token and trigger the browser flow with the new scopes.

`src/index.ts` is updated to call `uploadBouncesToSheet` from both `collectCommand` and `processCommand`. The existing CSV calls (`writeBounceCsv` for collect, the invalid path of `writeCsvFiles` for process) are removed.

## Error Handling

- **Insufficient scopes on cached token:** detected on first Drive/Sheets call. Print `Sheet access requires re-authentication. Run: bun run src/index.ts auth`. Exit non-zero. The `auth` command flow handles re-consent transparently because we always pass `prompt: "consent"`.
- **Drive/Sheets API errors (network, rate limit, transient 5xx):** surface the original message wrapped as `Could not update Google Sheet: <reason>`. No retry logic — fail and let the next run retry. Processed-state is not updated, so retry is automatic.
- **Folder or sheet deleted between cached lookup and use:** treated as cache miss → recreate.
- **Empty bounce list after dedup:** no append call made; log `No new bounces to add`.
- **CSV write failure in `process`:** unchanged from today (propagates as error).

## Backwards Compatibility

- **Existing tokens:** invalidated on first run after upgrade. User must re-run `auth`.
- **Existing local CSVs (`bounced-emails.csv`, `*_invalid.csv`):** left in place; no migration. New runs simply stop writing to them. User can delete them manually.
- **`--output` flag on `collect`:** removed. If a user passes it, `commander` will reject the unknown flag with a clear error.

## Documentation Changes

- `docs/setup.md`:
  - Step 2 (Enable APIs): also enable **Google Drive API** and **Google Sheets API** alongside Gmail API.
  - Step 3c (Data Access / Scopes): add `drive.file` (`https://www.googleapis.com/auth/drive.file`) and `spreadsheets` (`https://www.googleapis.com/auth/spreadsheets`) to the scope list.
  - Add a "Re-authentication after upgrade" subsection: existing users must re-run `auth` once after this change.
- `docs/usage.md`:
  - `collect`: rewrite the description — bounces upload to the `email village/Bounced Emails` Google Sheet. Remove `--output` row from the options table and remove the `--output ~/Desktop/bounces.csv` example.
  - `process`: remove all references to `*_invalid.csv` and the description of writing invalid rows to a separate file. Add note that bounces are recorded in the Sheet.
  - Update "Output Files" section to reflect: only the cleaned input CSV is written locally; the master bounce list lives in Drive.
- `docs/architecture.md`: add `src/sheets/` to the module list with a one-line description.
- `README.md`: update quick-start to mention the Sheet output and the new APIs to enable.
- `CLAUDE.md`:
  - Architecture section: add `src/sheets/` line.
  - Security section: update OAuth scope from "gmail.readonly only" to the three-scope list.

## Testing

Tests in `test/sheets/` using mocked `googleapis` clients (project rule: never hit real API).

- `drive-folder.test.ts`:
  - creates folder when search returns no results
  - reuses folder when search returns one match
- `bounce-sheet.test.ts`:
  - creates spreadsheet with header row when none exists
  - reuses sheet when found
  - `readExistingEmails` returns empty set for empty sheet
  - `readExistingEmails` returns normalized email set
  - `appendBounceRows` filters duplicates against existing set (covered at the uploader layer)
- `config-store.test.ts`:
  - returns null when file missing
  - round-trips folderId + sheetId
  - file is written with mode `0o600`
- `uploader.test.ts`:
  - dedupes against existing emails from sheet
  - skips append when filtered list is empty
  - propagates a wrapped error on Sheets API failure
- Auth scope-mismatch test: cached token without Drive scope triggers the clear `Run: bun run src/index.ts auth` message.

## Open Questions

None — design is fully specified.
