import { normalizeEmail } from "../utils/email-normalize.js";

const AUTOMATED_LOCAL_PART_PATTERNS: RegExp[] = [
  /no[-_.]?reply/,
  /do[-_.]?not[-_.]?reply/,
  /mailer[-_.]?daemon/,
  /notifications?/,
  /^notify/,
  /^postmaster$/,
  /^bounces?([+._-]|$)/,
  /^auto[-_.]?(reply|responder|mailer)/,
  /^reply[+-]/,
];

const AUTOMATED_DOMAIN_PATTERNS: RegExp[] = [
  /(^|\.)bounces?\./,
  /^(reply|notifications?|noreply)\./,
];

export function isAutomatedAddress(email: string): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at <= 0) {
    return false;
  }
  const localPart = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  return (
    AUTOMATED_LOCAL_PART_PATTERNS.some((p) => p.test(localPart)) ||
    AUTOMATED_DOMAIN_PATTERNS.some((p) => p.test(domain))
  );
}

export interface ContactFilterResult {
  kept: string[];
  removedOwn: number;
  removedAutomated: number;
}

export function filterContacts(
  addresses: Iterable<string>,
  ownAddresses: Iterable<string>
): ContactFilterResult {
  const own = new Set(Array.from(ownAddresses, normalizeEmail));
  const kept = new Set<string>();
  let removedOwn = 0;
  let removedAutomated = 0;

  for (const raw of addresses) {
    const address = normalizeEmail(raw);
    if (kept.has(address)) {
      continue;
    }
    if (own.has(address)) {
      removedOwn++;
    } else if (isAutomatedAddress(address)) {
      removedAutomated++;
    } else {
      kept.add(address);
    }
  }

  return {
    kept: Array.from(kept).sort(),
    removedOwn,
    removedAutomated,
  };
}
