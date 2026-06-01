# Multi-Account Bounce Collection — Design Spec

**Date:** 2026-06-01
**Status:** Approved (design)
**Feature:** `collect-all` command — authenticate a list of Gmail accounts and collect bounced emails from all of them into one CSV.

## Goal

Add a single command that reads a list of Gmail addresses from an environment
variable, authenticates each one, scans every account for bounce-back emails,
and writes all results into one combined CSV with a column identifying which
account each bounce came from.

Primary use case: testing the bounce-detection pipeline across several
personal `@gmail.com` test accounts at once.

## Authentication model (fixed constraint)

The accounts are personal `@gmail.com` accounts. Google's desktop OAuth flow
**cannot** be fully automated — a human must click through the consent screen
**once per account**. After that first consent, the refresh token is cached and
every future run is fully automatic with no browser.

Therefore:

- First run: each not-yet-consented account opens a browser for one-time sign-in.
- Later runs: cached per-account tokens are reused; no browser.
- Every test account must be added under **Google Auth Platform → Audience →
  Test users**, or sign-in is blocked.

## Components

### 1. Per-account token storage (`src/auth/oauth.ts`)

- Today: a single token at `~/.email-bouncer/token.json`.
- Add an optional `account` parameter to
  `getAuthenticatedClient(credentialsPath, account?)`:
  - When `account` is provided, the token path becomes
    `~/.email-bouncer/tokens/<email>.json`.
  - When omitted, behavior is unchanged (`token.json`) — existing
    `auth` / `process` / `collect` commands are unaffected.
- Token files keep `0o600`; the `tokens/` directory is created `0o700`.
- The email is used directly as the filename (`<email>.json`); `@`, `.`, and
  `+` are all valid filename characters on the target platforms.

### 2. Account identity verification

- After a fresh sign-in, call Gmail `users.getProfile` to read the
  actually-signed-in `emailAddress`.
- If it does not match the expected address from the env list:
  **warn, do NOT save the token, skip that account, continue.**
  This prevents caching one account's token under another's filename.
- When a cached token is reused, no extra profile check is required (the token
  is already bound to the correct account file).

### 3. New `collect-all` command (`src/index.ts`)

- **Account source:** `EMAIL_BOUNCER_ACCOUNTS` environment variable,
  comma-separated (e.g. `a@gmail.com,b@gmail.com`). Loaded from `.env`
  (Bun auto-loads `.env`). Whitespace around each entry is trimmed; empty
  entries (including trailing commas) are ignored.
- **Error if** the variable is missing or yields zero addresses — with a clear
  message showing the expected format.
- **Flags:**
  | Flag | Default | Description |
  |------|---------|-------------|
  | `--output <path>` | `./bounced-all.csv` | Combined output CSV |
  | `--credentials <path>` | `./client_secret.json` | OAuth2 credentials |
  | `--since <days>` | `30` | Look-back window for bounce search |
- **Sequential** loop over accounts. The OAuth callback server uses a single
  fixed port (3000), so parallel browser flows cannot work; sequential
  processing also respects Gmail API rate limits.

### 4. Shared extraction helper (refactor)

Extract the search → fetch → parse → per-address dedup logic currently inlined
in `collectCommand` into a reusable function:

```
collectBouncesForAccount(auth, sinceDays): BounceCsvRecord[]
```

Both `collect` and `collect-all` call it. This is a targeted refactor that
directly serves the new feature (no unrelated changes).

## Data flow

```
EMAIL_BOUNCER_ACCOUNTS env → [a@gmail.com, b@gmail.com, ...]
  for each account (sequential):
    getAuthenticatedClient(creds, account)   # cached token, else 1-time browser consent
    verify signed-in address == expected     # on fresh sign-in; else warn + skip
    records = collectBouncesForAccount(auth, since)
    tag each record with source_account = <account>
  → write ONE combined CSV: source_account, email, bounce_date, confidence
  → print per-account summary + grand total
```

Combined CSV shape:

```
source_account,email,bounce_date,confidence
test1@gmail.com,bad@x.com,2026-05-30,high
test1@gmail.com,nope@y.com,2026-05-29,high
test2@gmail.com,fake@z.com,2026-05-31,medium
```

The combined CSV writer is a small addition alongside the existing
`writeBounceCsv` (it adds the leading `source_account` column).

## Deliberate simplification: no processed-state dedup

`collect-all` does **not** use the global processed-state tracking that
`collect` uses. For a "check all accounts right now" testing workflow, every
run performs a fresh, complete scan of the `--since` window and writes the full
combined CSV — bounces are not silently filtered out after the first run.

Within a single account, bounces are still de-duplicated by recipient address
(keeping the most recent), identical to `collect`.

## Error handling

Per project rule "bounce processing must never crash — log failures and continue":

- An account that fails to authenticate, errors on the API, or is signed in as
  the wrong address → log a clear message, skip it, continue to the next.
- At the end, print a summary: which accounts succeeded, which were skipped and
  why, and the total number of bounces written.
- If **zero** accounts succeed, exit non-zero with a clear message.

## Documentation updates

- `docs/usage.md`: add a `collect-all` section and document
  `EMAIL_BOUNCER_ACCOUNTS`.
- `docs/setup.md`: note that **every** test account must be added under
  **Audience → Test users**, and each requires one browser sign-in the first
  time it is collected.

## Out of scope

- **Automated tests** — explicitly excluded at the user's request for this
  feature.
- Service-account / domain-wide-delegation auth (only applicable to a single
  Google Workspace org, not personal Gmail accounts).
- Parallel account processing.
- A `--accounts` CLI flag (accounts come from the environment variable only).
