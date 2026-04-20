# Design: `collect` command

## Summary

New CLI command that fetches all bounced email addresses from Gmail and writes them to a CSV file, without requiring an input CSV.

## Usage

```bash
bun run src/index.ts collect
bun run src/index.ts collect --output my-bounces.csv
bun run src/index.ts collect --since 60
```

## Flags

| Flag | Description | Default |
|---|---|---|
| `--output <path>` | Where to save the CSV | `./bounced-emails.csv` |
| `--credentials <path>` | Path to Google OAuth2 credentials JSON | `./client_secret.json` |
| `--since <days>` | How far back to look for bounces | `30` |

## Output CSV format

| Column | Description | Example |
|---|---|---|
| `email` | The bounced email address (normalized, lowercase) | `jane@example.com` |
| `bounce_date` | ISO 8601 timestamp of the bounce message | `2026-04-15T10:23:00.000Z` |
| `confidence` | Extraction confidence from the 4-layer pipeline | `high`, `medium`, or `low` |

## Behavior

1. Authenticate with Gmail using existing OAuth flow
2. Search for bounce messages using existing `buildBounceSearchQuery(sinceDays)`
3. Filter out already-processed message IDs using existing state store
4. Fetch full message details using existing `fetchMessagesWithDelay`
5. Parse each message through existing `isBounceMessage` and `extractBouncedRecipient`
6. Deduplicate by email address, keeping the most recent bounce per email
7. Write results to CSV at the output path (overwrites if file exists)
8. Update processed state so re-runs only pick up new bounces
9. Print summary to terminal: total bounces found, new (unprocessed), unique emails written, extraction failures

## What gets reused

- `src/auth/oauth.ts` — `getAuthenticatedClient`
- `src/gmail/client.ts` — `searchBounceMessages`, `fetchMessagesWithDelay`
- `src/gmail/queries.ts` — `buildBounceSearchQuery`
- `src/parser/bounce-detector.ts` — `isBounceMessage`, `getSubject`
- `src/parser/recipient-extractor.ts` — `extractBouncedRecipient`
- `src/state/processed-store.ts` — `loadProcessedState`, `saveProcessedState`
- `src/utils/email-normalize.ts` — `normalizeEmail`
- `src/utils/logger.ts` — `info`, `warn`, `printSummary`

## New code

1. **Command registration in `src/index.ts`** — new `collect` command with flags, calls a `collectCommand` function
2. **`collectCommand` function** — orchestrates the flow described above; lives in `src/index.ts` alongside existing `processCommand`
3. **CSV export helper** — small function to write the 3-column CSV using `csv-stringify`; added to `src/csv/writer.ts` as `writeBounceCsv`

## Error handling

- If Gmail auth fails, show user-friendly error and exit
- If no bounces found, print friendly message and exit (no empty CSV created)
- If extraction fails for a message, log warning and continue (never crash)
- If output directory doesn't exist, throw clear error

## Edge cases

- Re-running the command only processes new bounces (state tracking), but rewrites the CSV with all results from that run's new bounces. Subsequent runs overwrite the file.
- Same email bouncing multiple times: deduplicate, keep most recent bounce date
