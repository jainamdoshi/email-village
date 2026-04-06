# Architecture

## Overview

Email Bouncer is a TypeScript CLI tool built with Bun. It connects to Gmail via the Google API, finds bounce-back emails, parses out the failed email address, and updates a CSV file.

```
CLI (commander)
  │
  ├─ Auth Module ──── Gmail OAuth2 (google-auth-library)
  │
  ├─ Gmail Client ─── Gmail API (googleapis)
  │     │
  │     └─ Search → Fetch → Return full messages
  │
  ├─ Bounce Parser ── 4-layer extraction pipeline
  │     │
  │     ├─ Layer 1: X-Failed-Recipients header
  │     ├─ Layer 2: RFC 3464 DSN parsing
  │     ├─ Layer 3: Body regex patterns
  │     └─ Layer 4: Extended regex (broad, low confidence)
  │
  ├─ CSV Manager ──── Read/write CSV with column auto-detection
  │
  └─ State Tracker ── JSON file tracking processed message IDs
```

## Module Breakdown

### `src/auth/`
- **`credentials.ts`** — Loads `client_secret.json` from disk, validates format
- **`oauth.ts`** — Full OAuth2 flow: cached token check → browser consent → local callback server → token persistence

### `src/gmail/`
- **`queries.ts`** — Builds Gmail search queries for bounce detection
- **`client.ts`** — Wraps Gmail API: paginated message list, full message fetch with rate limiting (100ms between requests)

### `src/parser/`
- **`mime-utils.ts`** — MIME tree walking, base64url decoding, delivery-status part extraction
- **`bounce-detector.ts`** — Determines if a Gmail message is a bounce (checks sender, subject, headers)
- **`recipient-extractor.ts`** — The core module. 4-layer pipeline that extracts the bounced email address from a bounce notification

### `src/csv/`
- **`reader.ts`** — Reads CSV, auto-detects email column, returns structured data
- **`writer.ts`** — Writes valid/invalid CSVs, appends to existing invalid file

### `src/state/`
- **`processed-store.ts`** — Tracks processed Gmail message IDs in `~/.email-bouncer/processed.json`

### `src/utils/`
- **`email-normalize.ts`** — Email normalization and format validation
- **`logger.ts`** — Structured console output and summary formatting

## Bounce Parsing Pipeline

The 4-layer pipeline is the most critical part of the system. Each layer is tried in order; the first successful extraction wins.

| Layer | Source | Confidence | Coverage |
|-------|--------|-----------|----------|
| 1. X-Failed-Recipients | Gmail message header | High | Google-originated bounces |
| 2. DSN Final-Recipient | RFC 3464 MIME part | High | Standards-compliant MTAs |
| 3. Body regex | Plain text body | Medium | Common bounce message formats |
| 4. Extended regex | Plain text body | Low | Unusual/non-standard formats |

## Data Flow

1. **Search** — Gmail API query finds potential bounce messages
2. **Filter** — Remove already-processed message IDs (from state file)
3. **Fetch** — Download full message details for new bounces
4. **Detect** — Confirm each message is actually a bounce
5. **Extract** — Run 4-layer pipeline to get the bounced email
6. **Match** — Compare extracted emails against CSV
7. **Split** — Separate CSV into valid and invalid rows
8. **Write** — Save updated CSV and invalid file
9. **State** — Record processed message IDs for next run

## Key Design Decisions

- **No native dependencies** — Pure TypeScript/JS only. Avoids build issues across platforms.
- **Gmail API over IMAP** — Better search, structured data, native OAuth2 support.
- **JSON state over SQLite** — At ~500 emails/day, JSON is more than sufficient and avoids native deps.
- **Read-only Gmail scope** — The tool never modifies, sends, or deletes emails.
- **Append-only invalid file** — Invalid emails accumulate across runs, never overwritten.
