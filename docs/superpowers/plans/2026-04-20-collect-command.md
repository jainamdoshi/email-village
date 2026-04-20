# Collect Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `collect` CLI command that fetches bounced email addresses from Gmail and exports them to a CSV file with email, bounce_date, and confidence columns.

**Architecture:** New command registered in `src/index.ts` that reuses existing Gmail auth, bounce detection, and extraction pipeline. One new helper function in `src/csv/writer.ts` for writing the 3-column bounce CSV. A new `CollectResult` type for the summary. A dedicated `printCollectSummary` function in logger.

**Tech Stack:** Bun, TypeScript, commander, csv-stringify, googleapis

---

### Task 1: Add `CollectResult` type

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add the type to `src/types.ts`**

Add this after the existing `ProcessingResult` interface:

```typescript
export interface CollectResult {
  totalBounces: number;
  newBounces: number;
  uniqueEmails: number;
  extractionFailures: number;
  failedMessages: Array<{ messageId: string; subject: string }>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add CollectResult type for collect command"
```

---

### Task 2: Add `writeBounceCsv` helper

**Files:**
- Modify: `src/csv/writer.ts`
- Create: `test/csv/writer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/csv/writer.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { writeBounceCsv } from "../../src/csv/writer.js";
import { readFileSync, unlinkSync } from "fs";
import path from "path";

const TEST_DIR = path.join(import.meta.dir, "../fixtures");
const TEST_OUTPUT = path.join(TEST_DIR, "test-bounces.csv");

afterEach(() => {
  try {
    unlinkSync(TEST_OUTPUT);
  } catch {
    // ignore
  }
});

describe("writeBounceCsv", () => {
  it("writes CSV with correct headers and rows", () => {
    const records = [
      { email: "alice@test.com", bounceDate: "2026-04-15T10:00:00.000Z", confidence: "high" as const },
      { email: "bob@test.com", bounceDate: "2026-04-16T12:00:00.000Z", confidence: "medium" as const },
    ];

    writeBounceCsv(TEST_OUTPUT, records);

    const content = readFileSync(TEST_OUTPUT, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines[0]).toBe("email,bounce_date,confidence");
    expect(lines[1]).toBe("alice@test.com,2026-04-15T10:00:00.000Z,high");
    expect(lines[2]).toBe("bob@test.com,2026-04-16T12:00:00.000Z,medium");
  });

  it("writes only headers when records are empty", () => {
    writeBounceCsv(TEST_OUTPUT, []);

    const content = readFileSync(TEST_OUTPUT, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines[0]).toBe("email,bounce_date,confidence");
    expect(lines).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun test test/csv/writer.test.ts`
Expected: FAIL — `writeBounceCsv` is not exported

- [ ] **Step 3: Write the implementation**

Add to `src/csv/writer.ts` (after existing imports, add the new type and function):

```typescript
export interface BounceCsvRecord {
  email: string;
  bounceDate: string;
  confidence: string;
}

export function writeBounceCsv(
  outputPath: string,
  records: BounceCsvRecord[]
): void {
  const rows = records.map((r) => ({
    email: r.email,
    bounce_date: r.bounceDate,
    confidence: r.confidence,
  }));

  const csv = stringify(rows, {
    header: true,
    columns: ["email", "bounce_date", "confidence"],
  });

  writeFileSync(outputPath, csv);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun test test/csv/writer.test.ts`
Expected: PASS — both tests green

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/csv/writer.ts test/csv/writer.test.ts
git commit -m "feat: add writeBounceCsv helper for collect command"
```

---

### Task 3: Add `printCollectSummary` to logger

**Files:**
- Modify: `src/utils/logger.ts`

- [ ] **Step 1: Add the function**

Add this import at the top of `src/utils/logger.ts`:

```typescript
import type { ProcessingResult, CollectResult } from "../types.js";
```

(Replace the existing `import type { ProcessingResult } from "../types.js";`)

Add this function after the existing `printSummary`:

```typescript
export function printCollectSummary(result: CollectResult): void {
  console.log("\n--- Bounce Collection Summary ---");
  console.log(`Bounce emails found:           ${result.totalBounces}`);
  console.log(`New (not previously processed): ${result.newBounces}`);
  console.log(`Unique emails collected:       ${result.uniqueEmails}`);
  console.log(`Extraction failures:           ${result.extractionFailures}`);

  if (result.failedMessages.length > 0) {
    console.log("\nFailed to extract email from these messages:");
    for (const msg of result.failedMessages) {
      console.log(`  - [${msg.messageId}] ${msg.subject}`);
    }
  }

  console.log("---------------------------------\n");
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/logger.ts
git commit -m "feat: add printCollectSummary to logger"
```

---

### Task 4: Wire up the `collect` command in `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add new imports**

Add these to the existing imports at the top of `src/index.ts`:

```typescript
import { writeBounceCsv } from "./csv/writer.js";
import type { BounceCsvRecord } from "./csv/writer.js";
import { printCollectSummary } from "./utils/logger.js";
import type { CollectResult } from "./types.js";
```

Update the existing logger import to include `printCollectSummary`:

```typescript
import { printSummary, printCollectSummary, info, warn, error as logError } from "./utils/logger.js";
```

Update the existing types import to include `CollectResult`:

```typescript
import type { BounceRecord, ProcessingResult, CollectResult } from "./types.js";
```

Add import for `existsSync` and `dirname`:

```typescript
import { existsSync } from "fs";
import path from "path";
```

- [ ] **Step 2: Register the command**

Add this after the existing `program.command("auth")` block (before `program.parse()`):

```typescript
program
  .command("collect")
  .description("Collect bounced email addresses from Gmail and save to CSV")
  .option("--output <path>", "Path for the output CSV file", "./bounced-emails.csv")
  .option("--credentials <path>", "Path to Google OAuth2 credentials JSON", "./client_secret.json")
  .option("--since <days>", "Look back N days for bounces", "30")
  .action(async (options) => {
    try {
      await collectCommand(options);
    } catch (err) {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Implement `collectCommand` function**

Add this function after the existing `processCommand` function:

```typescript
async function collectCommand(options: {
  output: string;
  credentials: string;
  since: string;
}): Promise<void> {
  const sinceDays = parseInt(options.since, 10);
  if (isNaN(sinceDays) || sinceDays <= 0) {
    throw new Error("--since must be a positive number of days");
  }

  // Validate output directory exists
  const outputDir = path.dirname(path.resolve(options.output));
  if (!existsSync(outputDir)) {
    throw new Error(`Output directory does not exist: ${outputDir}`);
  }

  // Step 1: Authenticate with Gmail
  info("Authenticating with Gmail...");
  const auth = await getAuthenticatedClient(options.credentials);

  // Step 2: Search for bounce messages
  const query = buildBounceSearchQuery(sinceDays);
  const messageIds = await searchBounceMessages(auth, query);

  if (messageIds.length === 0) {
    info("No bounce messages found. Your inbox is clean!");
    return;
  }

  // Step 3: Filter out already-processed messages
  const processedState = loadProcessedState();
  const newMessageIds = messageIds.filter((id) => !processedState.has(id));

  info(
    `${messageIds.length} total bounces, ${newMessageIds.length} new (not previously processed).`
  );

  if (newMessageIds.length === 0) {
    info("No new bounce messages to process.");
    return;
  }

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

  if (csvRecords.length === 0) {
    info("No bounced email addresses could be extracted.");
    return;
  }

  const outputPath = path.resolve(options.output);
  writeBounceCsv(outputPath, csvRecords);
  info(`Bounced emails saved to: ${outputPath}`);

  // Step 7: Print summary
  const result: CollectResult = {
    totalBounces: messageIds.length,
    newBounces: newMessageIds.length,
    uniqueEmails: csvRecords.length,
    extractionFailures: failedMessages.length,
    failedMessages,
  };

  printCollectSummary(result);

  // Step 8: Update processed state
  for (const id of newMessageIds) {
    processedState.add(id);
  }
  saveProcessedState(processedState);
  info("State saved. These messages won't be re-processed next time.");
}
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun run typecheck`
Expected: No errors

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun test`
Expected: All tests pass

- [ ] **Step 6: Verify CLI help**

Run: `cd /Users/jainamdoshi/jainam/email-project && bun run src/index.ts --help`
Expected: Shows `collect` command in the list

Run: `cd /Users/jainamdoshi/jainam/email-project && bun run src/index.ts collect --help`
Expected: Shows `--output`, `--credentials`, `--since` flags with defaults

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add collect command to extract bounced emails to CSV"
```

---

### Task 5: Update documentation

**Files:**
- Modify: `docs/usage.md`
- Modify: `README.md`

- [ ] **Step 1: Update `docs/usage.md`**

Add a new section for the `collect` command (after the existing `process` command docs):

```markdown
## Collect bounced emails

Pull all bounced email addresses from your Gmail and save them to a CSV file.

```bash
bun run src/index.ts collect
```

This creates `bounced-emails.csv` in your current directory with three columns: `email`, `bounce_date`, and `confidence`.

### Options

| Flag | Description | Default |
|---|---|---|
| `--output <path>` | Where to save the CSV | `./bounced-emails.csv` |
| `--credentials <path>` | Path to Google OAuth2 credentials JSON | `./client_secret.json` |
| `--since <days>` | How far back to look for bounces | `30` |

### Examples

Collect bounces from the last 60 days:

```bash
bun run src/index.ts collect --since 60
```

Save to a specific file:

```bash
bun run src/index.ts collect --output ~/Desktop/bounces.csv
```
```

- [ ] **Step 2: Update `README.md`**

Add a line for the `collect` command in the quick-start or commands section:

```markdown
- `bun run src/index.ts collect` — Collect bounced email addresses from Gmail into a CSV
```

- [ ] **Step 3: Commit**

```bash
git add docs/usage.md README.md
git commit -m "docs: add collect command to usage docs and README"
```
