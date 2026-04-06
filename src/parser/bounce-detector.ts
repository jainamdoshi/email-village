import type { GmailMessage } from "../types.js";
import { getHeader } from "./mime-utils.js";

const BOUNCE_SENDERS = [
  "mailer-daemon",
  "postmaster",
  "mail delivery subsystem",
  "mail delivery system",
];

const BOUNCE_SUBJECT_KEYWORDS = [
  "delivery",
  "undeliverable",
  "returned",
  "failure",
  "bounced",
  "rejected",
  "not delivered",
  "mail delivery failed",
];

export function isBounceMessage(message: GmailMessage): boolean {
  const headers = message.payload?.headers;
  if (!headers) return false;

  const from = getHeader(headers, "From")?.toLowerCase() || "";
  const subject = getHeader(headers, "Subject")?.toLowerCase() || "";

  const isFromBounceSender = BOUNCE_SENDERS.some(
    (sender) => from.includes(sender)
  );

  const hasBouncySubject = BOUNCE_SUBJECT_KEYWORDS.some(
    (keyword) => subject.includes(keyword)
  );

  // Also check for X-Failed-Recipients header — definitive bounce signal
  const hasFailedRecipients = getHeader(headers, "X-Failed-Recipients") !== undefined;

  return hasFailedRecipients || (isFromBounceSender && hasBouncySubject);
}

export function getSubject(message: GmailMessage): string {
  return getHeader(message.payload?.headers, "Subject") || "(no subject)";
}
