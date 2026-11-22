import { describe, it, expect } from "bun:test";
import {
  isAutomatedAddress,
  filterContacts,
} from "../../src/parser/contact-filter.js";

describe("isAutomatedAddress", () => {
  it.each([
    "noreply@example.com",
    "no-reply@example.com",
    "no_reply@example.com",
    "NoReply@Example.com",
    "info-noreply@example.com",
    "donotreply@example.com",
    "do-not-reply@example.com",
    "notifications@github.com",
    "notification@example.com",
    "team-notifications@example.com",
    "notify@example.com",
    "mailer-daemon@googlemail.com",
    "MAILER-DAEMON@example.com",
    "postmaster@example.com",
    "bounce@example.com",
    "bounces+123@example.com",
    "bounce-abc@example.com",
    "autoreply@example.com",
    "auto-responder@example.com",
    "reply+abc123@reply.github.com",
    "anything@bounces.example.com",
    "x@noreply.github.com",
  ])("flags %s", (email) => {
    expect(isAutomatedAddress(email)).toBe(true);
  });

  it.each([
    "jane@example.com",
    "john.doe@company.co.uk",
    "reply@example.com",
    "bouncer.jane@example.com",
    "post@example.com",
    "noah@example.com",
  ])("keeps %s", (email) => {
    expect(isAutomatedAddress(email)).toBe(false);
  });
});

describe("filterContacts", () => {
  it("removes own and automated addresses, dedupes and sorts", () => {
    const result = filterContacts(
      [
        "zed@example.com",
        "Me@Gmail.com",
        "noreply@example.com",
        "alice@example.com",
        "ALICE@example.com",
      ],
      ["me@gmail.com"]
    );
    expect(result.kept).toEqual(["alice@example.com", "zed@example.com"]);
    expect(result.removedOwn).toBe(1);
    expect(result.removedAutomated).toBe(1);
  });

  it("returns empty for no input", () => {
    expect(filterContacts([], [])).toEqual({
      kept: [],
      removedOwn: 0,
      removedAutomated: 0,
    });
  });
});
