import { describe, it, expect } from "bun:test";
import { extractBouncedRecipient } from "../../src/parser/recipient-extractor.js";
import type { GmailMessage } from "../../src/types.js";

function base64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function makeMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "test-id",
    payload: {
      headers: [],
      mimeType: "text/plain",
      body: { data: "" },
    },
    ...overrides,
  };
}

describe("extractBouncedRecipient", () => {
  describe("Layer 1: X-Failed-Recipients header", () => {
    it("extracts email from X-Failed-Recipients header", () => {
      const message = makeMessage({
        payload: {
          headers: [
            { name: "X-Failed-Recipients", value: "user@example.com" },
          ],
          mimeType: "text/plain",
          body: { data: base64url("Some body text") },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).not.toBeNull();
      expect(result!.email).toBe("user@example.com");
      expect(result!.method).toBe("x-failed-recipients");
      expect(result!.confidence).toBe("high");
    });

    it("handles comma-separated X-Failed-Recipients", () => {
      const message = makeMessage({
        payload: {
          headers: [
            {
              name: "X-Failed-Recipients",
              value: "first@example.com, second@example.com",
            },
          ],
          mimeType: "text/plain",
          body: { data: base64url("body") },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).not.toBeNull();
      expect(result!.email).toBe("first@example.com");
    });

    it("trims whitespace and lowercases", () => {
      const message = makeMessage({
        payload: {
          headers: [
            { name: "X-Failed-Recipients", value: "  User@EXAMPLE.com  " },
          ],
          mimeType: "text/plain",
          body: { data: base64url("body") },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result!.email).toBe("user@example.com");
    });
  });

  describe("Layer 2: DSN Final-Recipient", () => {
    it("extracts from Final-Recipient in delivery-status part", () => {
      const dsnContent =
        "Reporting-MTA: dns; mail.example.com\r\n\r\n" +
        "Final-Recipient: rfc822; bounce@test.com\r\n" +
        "Action: failed\r\n" +
        "Status: 5.1.1\r\n";

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "multipart/report",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: base64url("Delivery failed") },
            },
            {
              mimeType: "message/delivery-status",
              body: { data: base64url(dsnContent) },
            },
          ],
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).not.toBeNull();
      expect(result!.email).toBe("bounce@test.com");
      expect(result!.method).toBe("dsn-final-recipient");
      expect(result!.confidence).toBe("high");
    });

    it("extracts from Original-Recipient when Final-Recipient is missing", () => {
      const dsnContent =
        "Reporting-MTA: dns; mail.example.com\r\n\r\n" +
        "Original-Recipient: rfc822; original@test.com\r\n" +
        "Action: failed\r\n";

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "multipart/report",
          parts: [
            {
              mimeType: "message/delivery-status",
              body: { data: base64url(dsnContent) },
            },
          ],
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result!.email).toBe("original@test.com");
    });
  });

  describe("Layer 3: Body regex patterns", () => {
    it("extracts from 'does not exist' pattern", () => {
      const body =
        "The email account user@nonexistent.com does not exist.";

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: base64url(body) },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).not.toBeNull();
      expect(result!.email).toBe("user@nonexistent.com");
      expect(result!.method).toBe("body-regex");
    });

    it("extracts from 'was not delivered' pattern", () => {
      const body =
        'Your message to <failed@domain.com> was not delivered.';

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: base64url(body) },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result!.email).toBe("failed@domain.com");
    });

    it("extracts from 'delivery to recipient failed' pattern", () => {
      const body =
        "Delivery to the following recipients failed:\n bad@example.org";

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: base64url(body) },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result!.email).toBe("bad@example.org");
    });

    it("extracts from '550' SMTP error pattern", () => {
      const body =
        'Remote server returned: 550 5.1.1 <gone@old-domain.com> Recipient not found';

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: base64url(body) },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result!.email).toBe("gone@old-domain.com");
    });
  });

  describe("Layer 4: Extended regex patterns", () => {
    it("extracts from generic failure + angle bracket pattern", () => {
      const body =
        "This message was undeliverable due to the following reason: <catch@all.net> could not receive mail.";

      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: base64url(body) },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).not.toBeNull();
      expect(result!.email).toBe("catch@all.net");
      expect(result!.confidence).toBe("low");
    });
  });

  describe("Edge cases", () => {
    it("returns null for messages with no extractable email", () => {
      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: base64url("Some random text with no email info") },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).toBeNull();
    });

    it("returns null for empty message", () => {
      const message = makeMessage({
        payload: {
          headers: [],
          mimeType: "text/plain",
          body: { data: "" },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result).toBeNull();
    });

    it("prefers X-Failed-Recipients over body regex", () => {
      const body =
        "The email account wrong@example.com does not exist.";

      const message = makeMessage({
        payload: {
          headers: [
            { name: "X-Failed-Recipients", value: "correct@example.com" },
          ],
          mimeType: "text/plain",
          body: { data: base64url(body) },
        },
      });

      const result = extractBouncedRecipient(message);
      expect(result!.email).toBe("correct@example.com");
      expect(result!.method).toBe("x-failed-recipients");
    });
  });
});
