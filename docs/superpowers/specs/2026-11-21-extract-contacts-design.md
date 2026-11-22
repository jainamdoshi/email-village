# extract-contacts — design

## Why
Build an outreach list from everyone the user has emailed with, across several Gmail accounts.

## Goals
- Scan all mail (every label, all time) in each account listed in `EMAIL_EXTRACT_ACCOUNTS`.
- Collect addresses from From, To, Cc and Bcc.
- Output one CSV, single `email` column, unique across accounts, sorted.
- Remove the accounts' own addresses and automated senders (noreply, notifications, mailer-daemon, bounce, etc.).

## Non-goals
- Display names, counts, first/last seen, per-account attribution.
- Spam and trash.
- Resuming a partial scan.

## Anti-goals
- Printing addresses to the terminal.
- Committing the output to the public repo (`*.csv` is gitignored).
- Silently returning partial results: unreadable messages and skipped accounts are reported.

## Approaches
1. **New CLI command reusing existing auth (chosen).** Reuses per-account OAuth and the accounts env parser; adds a full-mailbox lister and a header-only fetcher.
2. Standalone script outside the CLI: duplicates auth and token handling.
3. Reuse `searchBounceMessages` / `fetchMessagesWithDelay`: capped at 500 results and fetches full messages one at a time, too slow for whole mailboxes.

## Decisions
- Env var `EMAIL_EXTRACT_ACCOUNTS`, separate from `EMAIL_BOUNCER_ACCOUNTS` (user).
- Unique emails only, all time, skip spam/trash, exclude own addresses, strip automated senders (user).
- Header-only fetch (`format: metadata`), 5 in flight, backoff on 403 rate-limit errors; googleapis already retries 429/5xx (builder's call).
- Address extraction by regex over the header value rather than a full RFC 5322 parser (builder's call).
