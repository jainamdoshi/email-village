import type { GmailMessage } from "../types.js";
import { normalizeEmail } from "../utils/email-normalize.js";

export const ADDRESS_HEADERS = ["From", "To", "Cc", "Bcc"] as const;

const ADDRESS_HEADER_NAMES = new Set(
  ADDRESS_HEADERS.map((name) => name.toLowerCase())
);

// Matches the addr-spec inside `"Name, Jr" <a@b.com>` without a full RFC 5322 parser.
const ADDRESS_PATTERN =
  /[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export function extractAddressesFromHeader(
  value: string | null | undefined
): string[] {
  if (!value) {
    return [];
  }
  const matches = value.match(ADDRESS_PATTERN) ?? [];
  return Array.from(new Set(matches.map(normalizeEmail)));
}

export function extractAddressesFromMessage(message: GmailMessage): string[] {
  const addresses = new Set<string>();
  for (const header of message.payload?.headers ?? []) {
    if (!header.name || !ADDRESS_HEADER_NAMES.has(header.name.toLowerCase())) {
      continue;
    }
    for (const address of extractAddressesFromHeader(header.value)) {
      addresses.add(address);
    }
  }
  return Array.from(addresses);
}
