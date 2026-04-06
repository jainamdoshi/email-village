export function buildBounceSearchQuery(sinceDays: number): string {
  const parts = [
    "from:(mailer-daemon OR postmaster)",
    "subject:(delivery OR undeliverable OR returned OR failure OR bounced OR rejected)",
    `newer_than:${sinceDays}d`,
  ];

  return parts.join(" ");
}
