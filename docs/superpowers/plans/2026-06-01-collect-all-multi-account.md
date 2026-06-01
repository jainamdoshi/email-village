# Multi-Account Bounce Collection (`collect-all`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `collect-all` command that authenticates a list of Gmail accounts (from `EMAIL_BOUNCER_ACCOUNTS`) and collects bounced emails from every account into one combined CSV.

**Architecture:** A new commander subcommand reads the account list from the environment, then loops sequentially over accounts. Each account is authenticated through a per-account token cache (`~/.email-bouncer/tokens/<email>.json`), with a one-time browser consent on first run and an identity check that the signed-in address matches the expected one. Bounce search/fetch/parse logic is extracted into shared helpers reused by both `collect` and `collect-all`. Results are tagged with `source_account` and written to a single CSV.

**Tech Stack:** Bun, TypeScript (strict), commander, googleapis + google-auth-library, csv-stringify.

> **Testing note:** Per the project owner's explicit instruction, this feature ships **without automated tests**. Each task is verified with `bun run typecheck` and (where applicable) runnable CLI smoke checks. Do not add test files.

---

## File structure

- **Create** `src/utils/accounts.ts` — parse `EMAIL_BOUNCER_ACCOUNTS` into a clean string array.
- **Modify** `src/gmail/client.ts` — add `getProfileEmailAddress()` (Gmail `users.getProfile`).
- **Modify** `src/auth/oauth.ts` — per-account token paths; `account?` param on `getAuthenticatedClient`; identity verification before saving a fresh token.
- **Modify** `src/csv/writer.ts` — add `CombinedBounceCsvRecord` + `writeCombinedBounceCsv()` (adds `source_account` column).
- **Modify** `src/index.ts` — extract `fetchAndParseBounces()` + `collectBouncesForAccount()`, refactor `collectCommand` to reuse them, add the `collect-all` command + `collectAllCommand()`.
- **Modify** `.gitignore` — ignore `bounced-all.csv`.
- **Modify** `docs/usage.md`, `docs/setup.md` — document the command, env var, and test-user requirement.

---

## Task 1: Parse the accounts env var

**Files:**
- Create: `src/utils/accounts.ts`

- [ ] **Step 1: Create the parser**

Create `src/utils/accounts.ts`:

```typescript
/**
 * Parse the EMAIL_BOUNCER_ACCOUNTS environment variable into a list of
 * email addresses. Accepts a comma-separated string; trims whitespace and
 * drops empty entries (including those from trailing/duplicate commas).
 */
export function parseAccountsEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Smoke-check the parser**

Run:
```bash
bun -e 'const { parseAccountsEnv } = await import("./src/utils/accounts.ts"); console.log(JSON.stringify([parseAccountsEnv("a@gmail.com, b@gmail.com ,"), parseAccountsEnv(""), parseAccountsEnv(undefined)]))'
```
Expected output:
```
[["a@gmail.com","b@gmail.com"],[],[]]
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/accounts.ts
git commit -m "feat: add EMAIL_BOUNCER_ACCOUNTS env parser"
```

---

## Task 2: Add Gmail profile lookup

**Files:**
- Modify: `src/gmail/client.ts`

- [ ] **Step 1: Add `getProfileEmailAddress`**

Append this function to the end of `src/gmail/client.ts` (the file already imports `google` from `googleapis` and the `OAuth2Client` type):

```typescript
export async function getProfileEmailAddress(
  auth: OAuth2Client
): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });
  const response = await gmail.users.getProfile({ userId: "me" });
  return response.data.emailAddress || "";
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/gmail/client.ts
git commit -m "feat: add Gmail profile email lookup"
```

---

## Task 3: Per-account token storage + identity verification

**Files:**
- Modify: `src/auth/oauth.ts`

This task changes the private token-helper signatures to take an explicit token path, adds a per-account path resolver, and adds an optional `account` argument to `getAuthenticatedClient` that triggers identity verification before saving.

- [ ] **Step 1: Add imports**

In `src/auth/oauth.ts`, add these imports below the existing `import { loadCredentials } ...` line:

```typescript
import { getProfileEmailAddress } from "../gmail/client.js";
import { normalizeEmail } from "../utils/email-normalize.js";
```

- [ ] **Step 2: Add the per-account tokens directory constant**

Directly after the existing `const TOKEN_PATH = path.join(TOKEN_DIR, "token.json");` line, add:

```typescript
const TOKENS_DIR = path.join(TOKEN_DIR, "tokens");

function tokenPathForAccount(account: string): string {
  return path.join(TOKENS_DIR, `${account}.json`);
}
```

- [ ] **Step 3: Replace the token helper functions**

Replace the existing `ensureTokenDir`, `loadCachedToken`, and `saveToken` functions (the block from `function ensureTokenDir(): void {` through the end of `saveToken`) with:

```typescript
function loadCachedToken(tokenPath: string): Record<string, unknown> | null {
  if (!existsSync(tokenPath)) {
    return null;
  }
  try {
    const raw = readFileSync(tokenPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToken(token: Record<string, unknown>, tokenPath: string): void {
  const dir = path.dirname(tokenPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}
```

(`ensureTokenDir` is removed — `saveToken` now creates the parent directory itself, which also covers the new `tokens/` subdirectory.)

- [ ] **Step 4: Update `clearCachedToken` to accept an optional path**

Replace the existing `clearCachedToken` function with:

```typescript
export function clearCachedToken(tokenPath: string = TOKEN_PATH): boolean {
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
    return true;
  }
  return false;
}
```

(The default keeps `clearCachedToken()` working unchanged for the existing `auth` command.)

- [ ] **Step 5: Rewrite `getAuthenticatedClient`**

Replace the entire `getAuthenticatedClient` function with:

```typescript
export async function getAuthenticatedClient(
  credentialsPath: string,
  account?: string
): Promise<OAuth2Client> {
  const creds = loadCredentials(credentialsPath);
  const tokenPath = account ? tokenPathForAccount(account) : TOKEN_PATH;

  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`;
  const oauth2Client = new OAuth2Client(
    creds.clientId,
    creds.clientSecret,
    redirectUri
  );

  // Try cached token first
  const cachedToken = loadCachedToken(tokenPath);
  if (cachedToken) {
    oauth2Client.setCredentials(cachedToken);

    if (oauth2Client.credentials.refresh_token) {
      // Validate the token actually works before returning
      try {
        await oauth2Client.getAccessToken();
        info(
          account
            ? `Using cached credentials for ${account}.`
            : "Using cached credentials."
        );
        return oauth2Client;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (
          message.includes("invalid_grant") ||
          message.includes("Token has been expired or revoked")
        ) {
          logError(
            account
              ? `Authorization for ${account} expired. Re-authenticating...`
              : "Your Gmail authorization has expired. Re-authenticating..."
          );
          clearCachedToken(tokenPath);
          // Fall through to browser auth flow below
        } else {
          throw err;
        }
      }
    }
  }

  // No cached token — run browser auth flow
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  if (account) {
    info(`Sign in as ${account} in the browser window that opens.`);
  }

  const code = await getCodeFromBrowser(authUrl);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // When an account is expected, verify the signed-in identity before saving.
  if (account) {
    const actual = await getProfileEmailAddress(oauth2Client);
    if (normalizeEmail(actual) !== normalizeEmail(account)) {
      throw new Error(
        `Signed in as ${actual}, but expected ${account}. ` +
          `Token not saved — re-run and sign in with the correct account.`
      );
    }
  }

  saveToken(tokens as Record<string, unknown>, tokenPath);
  info(
    account
      ? `Authentication successful for ${account}. Token cached.`
      : "Authentication successful. Token cached."
  );

  return oauth2Client;
}
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (If `tsc` reports an unused `mkdirSync`/`chmodSync`, confirm they are still imported at the top of the file — they are used by `saveToken`.)

- [ ] **Step 7: Verify existing commands still parse**

Run: `bun run src/index.ts auth --help`
Expected: the `auth` command help prints with no runtime error (confirms the refactored module still loads).

- [ ] **Step 8: Commit**

```bash
git add src/auth/oauth.ts
git commit -m "feat: support per-account token storage and identity verification"
```

---

## Task 4: Combined CSV writer

**Files:**
- Modify: `src/csv/writer.ts`

- [ ] **Step 1: Add the combined record type and writer**

Append to the end of `src/csv/writer.ts` (the file already imports `stringify` and `writeFileSync`):

```typescript
export interface CombinedBounceCsvRecord extends BounceCsvRecord {
  sourceAccount: string;
}

export function writeCombinedBounceCsv(
  outputPath: string,
  records: CombinedBounceCsvRecord[]
): void {
  const rows = records.map((r) => ({
    source_account: r.sourceAccount,
    email: r.email,
    bounce_date: r.bounceDate,
    confidence: r.confidence,
  }));

  const csv = stringify(rows, {
    header: true,
    columns: ["source_account", "email", "bounce_date", "confidence"],
  });

  writeFileSync(outputPath, csv);
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/csv/writer.ts
git commit -m "feat: add combined multi-account bounce CSV writer"
```

---

## Task 5: Extract shared fetch/parse helpers and refactor `collect`

**Files:**
- Modify: `src/index.ts`

This task pulls the fetch+parse+dedup logic out of `collectCommand` into reusable helpers, so `collect-all` (Task 6) can share it. It must not change `collect`'s behavior (it still uses processed-state).

- [ ] **Step 1: Add the `OAuth2Client` type import**

At the top of `src/index.ts`, add below the existing imports:

```typescript
import type { OAuth2Client } from "google-auth-library";
```

- [ ] **Step 2: Add the two shared helper functions**

Add these two functions to `src/index.ts`, immediately **above** the `async function processCommand(` declaration:

```typescript
async function fetchAndParseBounces(
  auth: OAuth2Client,
  messageIds: string[]
): Promise<{
  records: BounceCsvRecord[];
  failedMessages: Array<{ messageId: string; subject: string }>;
}> {
  const messages = await fetchMessagesWithDelay(auth, messageIds);

  const records: Map<string, BounceCsvRecord> = new Map();
  const failedMessages: Array<{ messageId: string; subject: string }> = [];

  for (const message of messages) {
    const messageId = message.id || "unknown";

    if (!isBounceMessage(message)) {
      continue;
    }

    const extraction = extractBouncedRecipient(message);
    if (extraction) {
      const email = normalizeEmail(extraction.email);
      const bounceDate = new Date(
        parseInt(message.internalDate || "0", 10)
      ).toISOString();

      // Deduplicate: keep the most recent bounce per email
      const existing = records.get(email);
      if (!existing || bounceDate > existing.bounceDate) {
        records.set(email, {
          email,
          bounceDate,
          confidence: extraction.confidence,
        });
      }
    } else {
      failedMessages.push({
        messageId,
        subject: getSubject(message),
      });
    }
  }

  return { records: Array.from(records.values()), failedMessages };
}

async function collectBouncesForAccount(
  auth: OAuth2Client,
  sinceDays: number
): Promise<{
  records: BounceCsvRecord[];
  failedMessages: Array<{ messageId: string; subject: string }>;
  totalBounces: number;
}> {
  const query = buildBounceSearchQuery(sinceDays);
  const messageIds = await searchBounceMessages(auth, query);

  if (messageIds.length === 0) {
    return { records: [], failedMessages: [], totalBounces: 0 };
  }

  const { records, failedMessages } = await fetchAndParseBounces(
    auth,
    messageIds
  );
  return { records, failedMessages, totalBounces: messageIds.length };
}
```

- [ ] **Step 3: Refactor `collectCommand` to use the shared helper**

In `collectCommand`, replace the block that currently reads:

```typescript
  // Step 4: Fetch full message details
  info(`Fetching ${newMessageIds.length} message details...`);
  const messages = await fetchMessagesWithDelay(auth, newMessageIds);

  // Step 5: Parse bounce emails
  const records: Map<string, BounceCsvRecord> = new Map();
  const failedMessages: Array<{ messageId: string; subject: string }> = [];

  for (const message of messages) {
    const messageId = message.id || "unknown";

    if (!isBounceMessage(message)) {
      continue;
    }

    const extraction = extractBouncedRecipient(message);
    if (extraction) {
      const email = normalizeEmail(extraction.email);
      const bounceDate = new Date(
        parseInt(message.internalDate || "0", 10)
      ).toISOString();

      // Deduplicate: keep the most recent bounce per email
      const existing = records.get(email);
      if (!existing || bounceDate > existing.bounceDate) {
        records.set(email, {
          email,
          bounceDate,
          confidence: extraction.confidence,
        });
      }
    } else {
      failedMessages.push({
        messageId,
        subject: getSubject(message),
      });
    }
  }

  // Step 6: Write CSV
  const csvRecords = Array.from(records.values());
```

with:

```typescript
  // Step 4-5: Fetch and parse bounce emails
  info(`Fetching ${newMessageIds.length} message details...`);
  const { records: csvRecords, failedMessages } = await fetchAndParseBounces(
    auth,
    newMessageIds
  );

  // Step 6: Write CSV
```

(`csvRecords` is now a `BounceCsvRecord[]` directly; the rest of `collectCommand` — the `if (csvRecords.length === 0)` guard, `writeBounceCsv`, and the summary — is unchanged and still references `csvRecords` and `failedMessages`.)

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors. (If `tsc` flags `fetchMessagesWithDelay` as unused, confirm it is still called inside `fetchAndParseBounces` — it is.)

- [ ] **Step 5: Verify `collect` still parses**

Run: `bun run src/index.ts collect --help`
Expected: the `collect` command help prints with no runtime error.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "refactor: extract shared bounce fetch/parse helpers"
```

---

## Task 6: Add the `collect-all` command

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add imports**

At the top of `src/index.ts`:

1. Add the env parser import (below the other `./utils/...` imports):

```typescript
import { parseAccountsEnv } from "./utils/accounts.js";
```

2. Update the existing writer import line:

```typescript
import { writeCsvFiles, writeBounceCsv } from "./csv/writer.js";
```

to:

```typescript
import {
  writeCsvFiles,
  writeBounceCsv,
  writeCombinedBounceCsv,
} from "./csv/writer.js";
```

3. Update the existing writer type import line:

```typescript
import type { BounceCsvRecord } from "./csv/writer.js";
```

to:

```typescript
import type {
  BounceCsvRecord,
  CombinedBounceCsvRecord,
} from "./csv/writer.js";
```

- [ ] **Step 2: Register the command**

Add this command registration immediately **after** the existing `collect` command's `.action(...)` block (i.e. after the `collect` registration ends with `});`) and **before** the `async function processCommand(` block:

```typescript
program
  .command("collect-all")
  .description(
    "Authenticate accounts from EMAIL_BOUNCER_ACCOUNTS and collect bounces from all into one CSV"
  )
  .option(
    "--output <path>",
    "Path for the combined output CSV file",
    "./bounced-all.csv"
  )
  .option(
    "--credentials <path>",
    "Path to Google OAuth2 credentials JSON",
    "./client_secret.json"
  )
  .option("--since <days>", "Look back N days for bounces", "30")
  .action(async (options) => {
    try {
      await collectAllCommand(options);
    } catch (err) {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Add the `collectAllCommand` function**

Add this function immediately **after** the existing `collectCommand` function (before the final `program.parse();` line):

```typescript
async function collectAllCommand(options: {
  output: string;
  credentials: string;
  since: string;
}): Promise<void> {
  const sinceDays = parseInt(options.since, 10);
  if (isNaN(sinceDays) || sinceDays <= 0) {
    throw new Error("--since must be a positive number of days");
  }

  const accounts = parseAccountsEnv(process.env.EMAIL_BOUNCER_ACCOUNTS);
  if (accounts.length === 0) {
    throw new Error(
      "No accounts configured. Set EMAIL_BOUNCER_ACCOUNTS in your .env file, e.g.:\n" +
        "  EMAIL_BOUNCER_ACCOUNTS=test1@gmail.com,test2@gmail.com"
    );
  }

  // Resolve output path (allow passing a directory)
  let outputPath = path.resolve(options.output);
  if (existsSync(outputPath) && statSync(outputPath).isDirectory()) {
    outputPath = path.join(outputPath, "bounced-all.csv");
  }
  const outputDir = path.dirname(outputPath);
  if (!existsSync(outputDir)) {
    throw new Error(`Output directory does not exist: ${outputDir}`);
  }

  info(
    `Collecting bounces from ${accounts.length} account(s): ${accounts.join(
      ", "
    )}`
  );

  const combined: CombinedBounceCsvRecord[] = [];
  const succeeded: string[] = [];
  const skipped: Array<{ account: string; reason: string }> = [];

  for (const account of accounts) {
    info(`\n=== ${account} ===`);
    try {
      const auth = await getAuthenticatedClient(options.credentials, account);
      const { records, failedMessages, totalBounces } =
        await collectBouncesForAccount(auth, sinceDays);

      for (const record of records) {
        combined.push({ ...record, sourceAccount: account });
      }
      succeeded.push(account);
      info(
        `${account}: ${records.length} unique bounced address(es) from ` +
          `${totalBounces} bounce message(s)` +
          (failedMessages.length > 0
            ? `, ${failedMessages.length} extraction failure(s)`
            : "") +
          "."
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logError(`Skipping ${account}: ${reason}`);
      skipped.push({ account, reason });
    }
  }

  if (succeeded.length === 0) {
    throw new Error("No accounts could be processed. See the errors above.");
  }

  writeCombinedBounceCsv(outputPath, combined);

  console.log("\n--- Multi-Account Collection Summary ---");
  console.log(`Accounts processed:  ${succeeded.length}/${accounts.length}`);
  console.log(`Total bounces saved: ${combined.length}`);
  console.log(`Output file:         ${outputPath}`);
  if (skipped.length > 0) {
    console.log("\nSkipped accounts:");
    for (const item of skipped) {
      console.log(`  - ${item.account}: ${item.reason}`);
    }
  }
  console.log("----------------------------------------\n");
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Smoke-check command registration**

Run: `bun run src/index.ts collect-all --help`
Expected: help text listing `--output`, `--credentials`, and `--since`.

- [ ] **Step 6: Smoke-check the missing-env error path**

Run (note the empty env var, which should produce the friendly error, NOT a stack trace, and exit non-zero):
```bash
EMAIL_BOUNCER_ACCOUNTS="" bun run src/index.ts collect-all
```
Expected: output contains `No accounts configured. Set EMAIL_BOUNCER_ACCOUNTS` and the process exits with a non-zero status.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add collect-all command for multi-account bounce collection"
```

---

## Task 7: Gitignore + documentation

**Files:**
- Modify: `.gitignore`
- Modify: `docs/usage.md`
- Modify: `docs/setup.md`

- [ ] **Step 1: Ignore the combined output file**

In `.gitignore`, under the `# Output files` section, add `bounced-all.csv` so that block reads:

```
# Output files
invalid.csv
bounced-emails.csv
bounced-all.csv
*_invalid.csv
```

- [ ] **Step 2: Document the command in `docs/usage.md`**

In `docs/usage.md`, immediately after the `### \`collect\`` section (before `### \`auth\``), insert:

```markdown
### `collect-all` — Collect bounces from multiple accounts

```bash
bun run src/index.ts collect-all
```

Authenticates a list of Gmail accounts and collects bounced email addresses
from all of them into a single CSV. The account list comes from the
`EMAIL_BOUNCER_ACCOUNTS` environment variable (comma-separated), which you can
put in a `.env` file in the project root:

```
EMAIL_BOUNCER_ACCOUNTS=test1@gmail.com,test2@gmail.com
```

The first time each account is collected, a browser window opens for a one-time
Google sign-in — **sign in with the account shown in the terminal prompt**.
After that, each account's login is cached and future runs need no browser.

Each account must be added as a **Test user** in Google Cloud Console first
(see the setup guide), or its sign-in will be blocked.

The output CSV has four columns: `source_account`, `email`, `bounce_date`, and
`confidence`. Every run performs a fresh, complete scan of the look-back window
across all accounts (it does not skip previously seen bounces).

**Options:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--output <path>` | No | `./bounced-all.csv` | Where to save the combined CSV |
| `--credentials <path>` | No | `./client_secret.json` | Path to Google OAuth2 credentials |
| `--since <days>` | No | `30` | How many days back to search for bounces |

**Examples:**

```bash
# Collect from all accounts in EMAIL_BOUNCER_ACCOUNTS
bun run src/index.ts collect-all

# Look back 60 days, save to a specific file
bun run src/index.ts collect-all --since 60 --output ~/Desktop/all-bounces.csv
```

If an account fails to authenticate or you sign in with the wrong address, that
account is skipped and reported in the summary at the end — the run continues
with the remaining accounts.
```

- [ ] **Step 3: Document the test-user requirement in `docs/setup.md`**

In `docs/setup.md`, at the end of the `#### 3b. Audience` section (after the existing `> **Important:**` blockquote), add:

```markdown
> **Collecting from multiple accounts?** Add **every** account you plan to scan
> with `collect-all` here as a test user. Each one needs a one-time browser
> sign-in the first time it is collected; after that its login is cached.
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore docs/usage.md docs/setup.md
git commit -m "docs: document collect-all command and multi-account setup"
```

---

## Task 8: Manual end-to-end verification (requires real accounts)

This task needs the project owner's Google credentials and test accounts, so it is run interactively rather than automated.

**Files:** none (verification only)

- [ ] **Step 1: Confirm test users are registered**

In Google Cloud Console → Google Auth Platform → Audience → Test users, confirm every address you will list in `EMAIL_BOUNCER_ACCOUNTS` is present.

- [ ] **Step 2: Generate bounces (if needed)**

From each test account, send an email to a guaranteed-invalid address (e.g. `no-such-user-9281736@gmail.com`) so a `mailer-daemon` failure notice lands in that account's inbox.

- [ ] **Step 3: Configure the env var**

Create or edit `.env` in the project root:

```
EMAIL_BOUNCER_ACCOUNTS=test1@gmail.com,test2@gmail.com
```

- [ ] **Step 4: Run the command**

Run: `bun run src/index.ts collect-all`
Expected:
- A browser opens once per not-yet-authenticated account; signing in with the matching address succeeds.
- Signing in with the wrong address prints `Signed in as ... but expected ...` and that account is skipped.
- The summary prints `Accounts processed`, `Total bounces saved`, and the output path.

- [ ] **Step 5: Inspect the output**

Open `bounced-all.csv` and confirm the header is `source_account,email,bounce_date,confidence` and that bounces from different accounts show the correct `source_account`.

- [ ] **Step 6: Confirm caching**

Run `bun run src/index.ts collect-all` again.
Expected: no browser opens (terminal prints `Using cached credentials for ...` for each account).
