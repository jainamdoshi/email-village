import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { stringify } from "csv-stringify/sync";
import { parse } from "csv-parse/sync";
import type { CsvRow } from "../types.js";

export function writeCsvFiles(
  originalPath: string,
  validRows: CsvRow[],
  invalidRows: CsvRow[],
  headers: string[]
): { validPath: string; invalidPath: string } {
  const dir = path.dirname(originalPath);
  const ext = path.extname(originalPath);
  const base = path.basename(originalPath, ext);

  const validPath = originalPath; // Overwrite original with valid entries
  const invalidPath = path.join(dir, `${base}_invalid${ext}`);

  // Write valid rows back to original file
  const validCsv = stringify(validRows, { header: true, columns: headers });
  writeFileSync(validPath, validCsv);

  // Append to or create invalid file
  if (invalidRows.length > 0) {
    let existingInvalid: CsvRow[] = [];

    if (existsSync(invalidPath)) {
      const existingContent = readFileSync(invalidPath, "utf-8");
      existingInvalid = parse(existingContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    }

    const allInvalid = [...existingInvalid, ...invalidRows];
    const invalidCsv = stringify(allInvalid, {
      header: true,
      columns: headers,
    });
    writeFileSync(invalidPath, invalidCsv);
  }

  return { validPath, invalidPath };
}

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
