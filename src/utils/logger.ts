import type { ProcessingResult, CollectResult } from "../types.js";

export function printSummary(result: ProcessingResult): void {
  console.log("\n--- Bounce Processing Summary ---");
  console.log(`Bounce emails found:           ${result.totalBounces}`);
  console.log(`New (not previously processed): ${result.newBounces}`);
  console.log(`Matched in CSV:                ${result.matchedInCsv}`);
  console.log(`Moved to invalid.csv:          ${result.movedToInvalid}`);
  console.log(`Not in CSV:                    ${result.notInCsv}`);
  console.log(`Extraction failures:           ${result.extractionFailures}`);

  if (result.failedMessages.length > 0) {
    console.log("\nFailed to extract email from these messages:");
    for (const msg of result.failedMessages) {
      console.log(`  - [${msg.messageId}] ${msg.subject}`);
    }
  }

  console.log("---------------------------------\n");
}

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

export function info(message: string): void {
  console.log(`[info] ${message}`);
}

export function warn(message: string): void {
  console.warn(`[warn] ${message}`);
}

export function error(message: string): void {
  console.error(`[error] ${message}`);
}
