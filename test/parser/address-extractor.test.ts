import { describe, it, expect } from "bun:test";
import {
  extractAddressesFromHeader,
  extractAddressesFromMessage,
} from "../../src/parser/address-extractor.js";
import type { GmailMessage } from "../../src/types.js";

describe("extractAddressesFromHeader", () => {
  it("extracts a bare address", () => {
    expect(extractAddressesFromHeader("jane@example.com")).toEqual([
      "jane@example.com",
    ]);
  });

  it("extracts from display-name form with quoted commas", () => {
    expect(
      extractAddressesFromHeader('"Doe, John" <John.Doe@Example.com>, Jane <jane@x.co.uk>')
    ).toEqual(["john.doe@example.com", "jane@x.co.uk"]);
  });

  it("handles plus addressing and apostrophes", () => {
    expect(
      extractAddressesFromHeader("o'brien+news@example.com")
    ).toEqual(["o'brien+news@example.com"]);
  });

  it("dedupes when the display name repeats the address", () => {
    expect(
      extractAddressesFromHeader('"a@b.com" <a@b.com>')
    ).toEqual(["a@b.com"]);
  });

  it("dedupes Outlook-style single-quoted display names", () => {
    expect(
      extractAddressesFromHeader("'jane@x.com' <jane@x.com>, 'Bob' <bob@x.com>")
    ).toEqual(["jane@x.com", "bob@x.com"]);
  });

  it("returns nothing for undisclosed recipients", () => {
    expect(extractAddressesFromHeader("undisclosed-recipients:;")).toEqual([]);
  });

  it("returns nothing for empty, null and garbage input", () => {
    expect(extractAddressesFromHeader("")).toEqual([]);
    expect(extractAddressesFromHeader(null)).toEqual([]);
    expect(extractAddressesFromHeader(undefined)).toEqual([]);
    expect(extractAddressesFromHeader("not an email @ all")).toEqual([]);
  });
});

describe("extractAddressesFromMessage", () => {
  function makeMessage(headers: Array<{ name: string; value: string }>): GmailMessage {
    return { id: "m1", payload: { headers } };
  }

  it("reads From, To, Cc and Bcc case-insensitively", () => {
    const message = makeMessage([
      { name: "From", value: "Sender <sender@example.com>" },
      { name: "to", value: "a@example.com, b@example.com" },
      { name: "CC", value: "c@example.com" },
      { name: "Bcc", value: "d@example.com" },
    ]);
    expect(extractAddressesFromMessage(message).sort()).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
      "d@example.com",
      "sender@example.com",
    ]);
  });

  it("ignores other headers", () => {
    const message = makeMessage([
      { name: "Reply-To", value: "reply@example.com" },
      { name: "Message-ID", value: "<abc@mail.example.com>" },
      { name: "To", value: "a@example.com" },
    ]);
    expect(extractAddressesFromMessage(message)).toEqual(["a@example.com"]);
  });

  it("handles a message with no payload", () => {
    expect(extractAddressesFromMessage({ id: "m2" })).toEqual([]);
  });
});
