import { Command } from "commander";
import type { OAuth2Client } from "google-auth-library";
import { getAuthenticatedClient, clearCachedToken } from "./auth/oauth.js";
import {
  searchBounceMessages,
  fetchMessagesWithDelay,
} from "./gmail/client.js";
import { buildBounceSearchQuery } from "./gmail/queries.js";
import { isBounceMessage, getSubject } from "./parser/bounce-detector.js";
import { extractBouncedRecipient } from "./parser/recipient-extractor.js";
import { readCsv } from "./csv/reader.js";
import {
  writeCsvFiles,
  writeBounceCsv,
  writeCombinedBounceCsv,
} from "./csv/writer.js";
import type { BounceCsvRecord, CombinedBounceCsvRecord } from "./csv/writer.js";
import {
  loadProcessedState,
  saveProcessedState,
  getLastRunTime,
  getProcessedCount,
} from "./state/processed-store.js";
import { normalizeEmail } from "./utils/email-normalize.js";
import { parseAccountsEnv } from "./utils/accounts.js";
import { printSummary, printCollectSummary, info, warn, error as logError } from "./utils/logger.js";
import type { BounceRecord, ProcessingResult, CollectResult } from "./types.js";
import { existsSync, statSync } from "fs";
import path from "path";

const program = new Command();

program
  .name("email-bouncer")
  .description("Filter bounced emails from Gmail and clean CSV email lists")
  .version("0.1.0");

program
  .command("process")
  .description("Process bounce emails and update CSV")
  .requiredOption("--csv <path>", "Path to the CSV file with email addresses")
  .option("--credentials <path>", "Path to Google OAuth2 credentials JSON", "./client_secret.json")
  .option("--email-column <name>", "Name of the column containing emails")
  .option("--since <days>", "Look back N days for bounces", "30")
  .option("--dry-run", "Show what would be removed without modifying files", false)
  .action(async (options) => {
    try {
      await processCommand(options);
    } catch (err) {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("auth")
  .description("Authenticate with Gmail (or re-authenticate)")
  .option("--credentials <path>", "Path to Google OAuth2 credentials JSON", "./client_secret.json")
  .action(async (options) => {
    try {
      clearCachedToken();
      info("Cleared cached token. Starting fresh authentication...");
      await getAuthenticatedClient(options.credentials);
      info("Authentication complete! You can now run the 'process' command.");
    } catch (err) {
      logError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show status of last run")
  .action(() => {
    const lastRun = getLastRunTime();
    const count = getProcessedCount();

    if (!lastRun) {
      info("No previous runs found.");
      return;
    }

    console.log(`Last run:            ${lastRun}`);
    console.log(`Total processed IDs: ${count}`);
  });

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

async function processCommand(options: {
  csv: string;
  credentials: string;
  emailColumn?: string;
  since: string;
  dryRun: boolean;
}): Promise<void> {
  const sinceDays = parseInt(options.since, 10);
  if (isNaN(sinceDays) || sinceDays <= 0) {
    throw new Error("--since must be a positive number of days");
  }

  // Step 1: Read CSV
  info(`Reading CSV file: ${options.csv}`);
  const csvData = readCsv(options.csv, options.emailColumn);
  info(
    `Loaded ${csvData.rows.length} rows. Email column: "${csvData.emailColumn}"`
  );

  // Step 2: Authenticate with Gmail
  info("Authenticating with Gmail...");
  const auth = await getAuthenticatedClient(options.credentials);

  // Step 3: Search for bounce messages
  const query = buildBounceSearchQuery(sinceDays);
  const messageIds = await searchBounceMessages(auth, query);

  if (messageIds.length === 0) {
    info("No bounce messages found. Your email list is clean!");
    return;
  }

  // Step 4: Filter out already-processed messages
  const processedState = loadProcessedState();
  const newMessageIds = messageIds.filter((id) => !processedState.has(id));

  info(
    `${messageIds.length} total bounces, ${newMessageIds.length} new (not previously processed).`
  );

  if (newMessageIds.length === 0) {
    info("No new bounce messages to process.");
    return;
  }

  // Step 5: Fetch full message details
  info(`Fetching ${newMessageIds.length} message details...`);
  const messages = await fetchMessagesWithDelay(auth, newMessageIds);

  // Step 6: Parse bounce emails
  const bounceRecords: BounceRecord[] = [];
  const failedMessages: Array<{ messageId: string; subject: string }> = [];

  for (const message of messages) {
    const messageId = message.id || "unknown";

    if (!isBounceMessage(message)) {
      continue;
    }

    const extraction = extractBouncedRecipient(message);
    if (extraction) {
      bounceRecords.push({
        messageId,
        bouncedEmail: extraction.email,
        extractionMethod: extraction.method,
        confidence: extraction.confidence,
        bounceType: "hard",
        timestamp: new Date(
          parseInt(message.internalDate || "0", 10)
        ).toISOString(),
        subject: getSubject(message),
      });
    } else {
      failedMessages.push({
        messageId,
        subject: getSubject(message),
      });
    }
  }

  // Step 7: Deduplicate bounced emails
  const bouncedEmails = new Set(
    bounceRecords.map((r) => normalizeEmail(r.bouncedEmail))
  );

  // Step 8: Split CSV into valid and invalid
  const validRows = csvData.rows.filter(
    (row) => !bouncedEmails.has(normalizeEmail(row[csvData.emailColumn]))
  );
  const invalidRows = csvData.rows.filter((row) =>
    bouncedEmails.has(normalizeEmail(row[csvData.emailColumn]))
  );

  const result: ProcessingResult = {
    totalBounces: messageIds.length,
    newBounces: newMessageIds.length,
    matchedInCsv: invalidRows.length,
    movedToInvalid: invalidRows.length,
    notInCsv: bouncedEmails.size - invalidRows.length,
    extractionFailures: failedMessages.length,
    failedMessages,
  };

  printSummary(result);

  // Step 9: Write files (unless dry-run)
  if (options.dryRun) {
    info("DRY RUN — no files were modified.");
    if (invalidRows.length > 0) {
      info("Emails that would be moved to invalid:");
      for (const row of invalidRows) {
        console.log(`  - ${row[csvData.emailColumn]}`);
      }
    }
  } else {
    if (invalidRows.length > 0) {
      const paths = writeCsvFiles(
        options.csv,
        validRows,
        invalidRows,
        csvData.headers
      );
      info(`Updated: ${paths.validPath}`);
      info(`Invalid emails moved to: ${paths.invalidPath}`);
    } else {
      info("No matching emails found in CSV to remove.");
    }

    // Step 10: Update processed state
    for (const id of newMessageIds) {
      processedState.add(id);
    }
    saveProcessedState(processedState);
    info("State saved. These messages won't be re-processed next time.");
  }
}

async function collectCommand(options: {
  output: string;
  credentials: string;
  since: string;
}): Promise<void> {
  const sinceDays = parseInt(options.since, 10);
  if (isNaN(sinceDays) || sinceDays <= 0) {
    throw new Error("--since must be a positive number of days");
  }

  // If --output is a directory, append the default filename
  const resolvedOutput = path.resolve(options.output);
  if (existsSync(resolvedOutput) && statSync(resolvedOutput).isDirectory()) {
    options.output = path.join(resolvedOutput, "bounced-emails.csv");
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

  // Step 4-5: Fetch and parse bounce emails
  info(`Fetching ${newMessageIds.length} message details...`);
  const { records: csvRecords, failedMessages } = await fetchAndParseBounces(
    auth,
    newMessageIds
  );

  // Step 6: Write CSV

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

program.parse();
