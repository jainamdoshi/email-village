import type { GmailMessage, ExtractionResult } from "../types.js";
import {
  getHeader,
  getPlainTextBody,
  findDeliveryStatusPart,
} from "./mime-utils.js";
import { normalizeEmail, isValidEmailFormat } from "../utils/email-normalize.js";

/**
 * 4-layer extraction pipeline for getting the bounced email address
 * from a bounce notification. Each layer is tried in order;
 * first valid extraction wins.
 */
export function extractBouncedRecipient(
  message: GmailMessage
): ExtractionResult | null {
  return (
    tryXFailedRecipients(message) ||
    tryDsnFinalRecipient(message) ||
    tryBodyRegex(message) ||
    tryExtendedRegex(message)
  );
}

// Layer 1: X-Failed-Recipients header (Google bounces)
function tryXFailedRecipients(
  message: GmailMessage
): ExtractionResult | null {
  const header = getHeader(
    message.payload?.headers,
    "X-Failed-Recipients"
  );
  if (!header) return null;

  // Can be comma-separated list of emails
  const emails = header.split(",").map((e) => normalizeEmail(e));
  const validEmail = emails.find(isValidEmailFormat);

  if (validEmail) {
    return {
      email: validEmail,
      method: "x-failed-recipients",
      confidence: "high",
    };
  }

  return null;
}

// Layer 2: RFC 3464 DSN - Final-Recipient / Original-Recipient
function tryDsnFinalRecipient(
  message: GmailMessage
): ExtractionResult | null {
  const dsnContent = findDeliveryStatusPart(message);
  if (!dsnContent) return null;

  // Try Final-Recipient first, then Original-Recipient
  const patterns = [
    /Final-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i,
    /Original-Recipient:\s*rfc822;\s*([^\s\r\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = dsnContent.match(pattern);
    if (match) {
      const email = normalizeEmail(match[1]);
      if (isValidEmailFormat(email)) {
        // Check if this is a hard bounce (Action: failed)
        const actionMatch = dsnContent.match(/Action:\s*(\w+)/i);
        const isHardBounce =
          !actionMatch || actionMatch[1].toLowerCase() === "failed";

        if (isHardBounce) {
          return {
            email,
            method: "dsn-final-recipient",
            confidence: "high",
          };
        }
      }
    }
  }

  return null;
}

// Layer 3: Common body text patterns
const BODY_PATTERNS: RegExp[] = [
  // "The email account <user@example.com> does not exist"
  /the email account\s*<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?\s.*?does(?:n't| not) exist/i,

  // "<user@example.com> was not delivered"
  /<([^>]+@[^>]+)>\s*was not delivered/i,

  // "Delivery to the following recipient(s) failed:\n user@example.com"
  /delivery to the following recipient[s]? failed[^\n]*\n\s*([^\s\r\n]+@[^\s\r\n]+)/i,

  // "could not be delivered to: user@example.com"
  /could not be delivered to:?\s*<?([^\s<>\r\n]+@[^\s<>\r\n]+)>?/i,

  // "Delivery to <user@example.com> has failed"
  /delivery to\s*<?([^>]+@[^>]+)>?\s*(?:has\s+)?failed/i,

  // "User unknown: user@example.com"
  /user unknown[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,

  // "550 No such user - <user@example.com>"
  /(?:550|553|554)[^\n]*<([^>]+@[^>]+)>/i,

  // "Recipient address rejected: user@example.com"
  /recipient address rejected[:\s]+<?([^\s<>\r\n]+@[^\s<>\r\n]+)>?/i,
];

function tryBodyRegex(
  message: GmailMessage
): ExtractionResult | null {
  const body = getPlainTextBody(message);
  if (!body) return null;

  for (const pattern of BODY_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      const email = normalizeEmail(match[1]);
      if (isValidEmailFormat(email)) {
        return {
          email,
          method: "body-regex",
          confidence: "medium",
        };
      }
    }
  }

  return null;
}

// Layer 4: Extended patterns (broader, lower confidence)
const EXTENDED_PATTERNS: RegExp[] = [
  // Generic: failure keyword near angle-bracketed email
  /(?:failed|rejected|bounce|undeliverable|not delivered)[\s\S]{0,200}<([^>]+@[^>]+)>/i,

  // "Message not delivered to: user@example.com"
  /message not delivered[^@]*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,

  // Last resort: first email in angle brackets in the body (after the "from" line)
  /(?:to|recipient)[:\s]*<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i,
];

function tryExtendedRegex(
  message: GmailMessage
): ExtractionResult | null {
  const body = getPlainTextBody(message);
  if (!body) return null;

  for (const pattern of EXTENDED_PATTERNS) {
    const match = body.match(pattern);
    if (match) {
      const email = normalizeEmail(match[1]);
      if (isValidEmailFormat(email)) {
        return {
          email,
          method: "extended-regex",
          confidence: "low",
        };
      }
    }
  }

  return null;
}
