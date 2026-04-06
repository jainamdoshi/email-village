import { describe, it, expect } from "bun:test";
import { isBounceMessage, getSubject } from "../../src/parser/bounce-detector.js";
import type { GmailMessage } from "../../src/types.js";

function makeMessage(
  from: string,
  subject: string,
  extraHeaders: Array<{ name: string; value: string }> = []
): GmailMessage {
  return {
    id: "test-id",
    payload: {
      headers: [
        { name: "From", value: from },
        { name: "Subject", value: subject },
        ...extraHeaders,
      ],
      mimeType: "text/plain",
      body: { data: "" },
    },
  };
}

describe("isBounceMessage", () => {
  it("detects Google mailer-daemon bounces", () => {
    const msg = makeMessage(
      "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      "Delivery Status Notification (Failure)"
    );
    expect(isBounceMessage(msg)).toBe(true);
  });

  it("detects postmaster bounces", () => {
    const msg = makeMessage(
      "postmaster@mail.example.com",
      "Undeliverable: Your message"
    );
    expect(isBounceMessage(msg)).toBe(true);
  });

  it("detects messages with X-Failed-Recipients header", () => {
    const msg = makeMessage("someone@example.com", "Regular subject", [
      { name: "X-Failed-Recipients", value: "bad@example.com" },
    ]);
    expect(isBounceMessage(msg)).toBe(true);
  });

  it("rejects normal emails", () => {
    const msg = makeMessage(
      "friend@example.com",
      "Hey, how are you?"
    );
    expect(isBounceMessage(msg)).toBe(false);
  });

  it("rejects emails from mailer-daemon without bouncy subject", () => {
    const msg = makeMessage(
      "mailer-daemon@example.com",
      "Welcome to our service"
    );
    expect(isBounceMessage(msg)).toBe(false);
  });
});

describe("getSubject", () => {
  it("returns subject from message", () => {
    const msg = makeMessage("test@test.com", "Test Subject");
    expect(getSubject(msg)).toBe("Test Subject");
  });

  it("returns fallback for missing subject", () => {
    const msg: GmailMessage = {
      id: "test",
      payload: { headers: [], mimeType: "text/plain" },
    };
    expect(getSubject(msg)).toBe("(no subject)");
  });
});
