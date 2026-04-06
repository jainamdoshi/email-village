import { readFileSync } from "fs";
import { parse } from "csv-parse/sync";
import type { CsvRow } from "../types.js";

const EMAIL_COLUMN_NAMES = [
  "email",
  "e-mail",
  "email_address",
  "emailaddress",
  "email address",
  "mail",
  "e_mail",
];

export interface CsvData {
  rows: CsvRow[];
  headers: string[];
  emailColumn: string;
}

export function readCsv(csvPath: string, emailColumnOverride?: string): CsvData {
  const content = readFileSync(csvPath, "utf-8");

  const rows: CsvRow[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (rows.length === 0) {
    throw new Error(`CSV file is empty or has no data rows: ${csvPath}`);
  }

  const headers = Object.keys(rows[0]);

  // Determine email column
  let emailColumn: string;

  if (emailColumnOverride) {
    const found = headers.find(
      (h) => h.toLowerCase() === emailColumnOverride.toLowerCase()
    );
    if (!found) {
      throw new Error(
        `Column "${emailColumnOverride}" not found in CSV. Available columns: ${headers.join(", ")}`
      );
    }
    emailColumn = found;
  } else {
    const detected = headers.find((h) =>
      EMAIL_COLUMN_NAMES.includes(h.toLowerCase())
    );
    if (!detected) {
      throw new Error(
        `Could not auto-detect email column. Available columns: ${headers.join(", ")}\n` +
          "Use --email-column to specify which column contains email addresses."
      );
    }
    emailColumn = detected;
  }

  return { rows, headers, emailColumn };
}
