import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readCsv } from "../../src/csv/reader.js";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import path from "path";

const TEST_DIR = path.join(import.meta.dir, "../fixtures");
const TEST_CSV = path.join(TEST_DIR, "test-emails.csv");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try {
    unlinkSync(TEST_CSV);
  } catch {
    // ignore
  }
});

describe("readCsv", () => {
  it("reads CSV and auto-detects email column", () => {
    writeFileSync(
      TEST_CSV,
      "name,email,company\nAlice,alice@test.com,Acme\nBob,bob@test.com,Corp\n"
    );

    const result = readCsv(TEST_CSV);
    expect(result.rows).toHaveLength(2);
    expect(result.emailColumn).toBe("email");
    expect(result.headers).toEqual(["name", "email", "company"]);
    expect(result.rows[0]["email"]).toBe("alice@test.com");
  });

  it("auto-detects 'Email Address' column (case insensitive)", () => {
    writeFileSync(
      TEST_CSV,
      "Name,Email Address,Phone\nAlice,alice@test.com,555\n"
    );

    const result = readCsv(TEST_CSV);
    expect(result.emailColumn).toBe("Email Address");
  });

  it("uses specified email column override", () => {
    writeFileSync(
      TEST_CSV,
      "contact_name,contact_email,notes\nAlice,alice@test.com,VIP\n"
    );

    const result = readCsv(TEST_CSV, "contact_email");
    expect(result.emailColumn).toBe("contact_email");
  });

  it("throws when email column cannot be detected", () => {
    writeFileSync(
      TEST_CSV,
      "name,address,phone\nAlice,123 Main St,555\n"
    );

    expect(() => readCsv(TEST_CSV)).toThrow("Could not auto-detect email column");
  });

  it("throws when specified column does not exist", () => {
    writeFileSync(
      TEST_CSV,
      "name,email,phone\nAlice,alice@test.com,555\n"
    );

    expect(() => readCsv(TEST_CSV, "nonexistent")).toThrow(
      'Column "nonexistent" not found'
    );
  });

  it("throws on empty CSV", () => {
    writeFileSync(TEST_CSV, "name,email\n");

    expect(() => readCsv(TEST_CSV)).toThrow("empty");
  });
});
