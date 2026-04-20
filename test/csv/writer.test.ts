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
