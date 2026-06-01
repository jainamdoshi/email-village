/**
 * Parse the EMAIL_BOUNCER_ACCOUNTS environment variable into a list of
 * email addresses. Accepts a comma-separated string; trims whitespace and
 * drops empty entries (including those from trailing/duplicate commas).
 */
export function parseAccountsEnv(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
