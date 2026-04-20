# Usage Guide

## Commands

### `process` — Scan bounces and clean your CSV

```bash
bun run src/index.ts process --csv contacts.csv
```

This is the main command. It:
1. Connects to your Gmail
2. Finds bounce-back emails (delivery failures, mailer-daemon messages)
3. Extracts the invalid email address from each bounce
4. Removes matching emails from your CSV
5. Saves removed emails to a separate `contacts_invalid.csv` file

**Options:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--csv <path>` | Yes | — | Path to your CSV file |
| `--credentials <path>` | No | `./client_secret.json` | Path to Google OAuth2 credentials |
| `--email-column <name>` | No | Auto-detected | Name of the column containing emails |
| `--since <days>` | No | `30` | How many days back to search for bounces |
| `--dry-run` | No | `false` | Preview changes without modifying files |

**Examples:**

```bash
# Basic usage
bun run src/index.ts process --csv contacts.csv

# Only check last 7 days of bounces
bun run src/index.ts process --csv contacts.csv --since 7

# Preview what would be removed
bun run src/index.ts process --csv contacts.csv --dry-run

# Specify email column manually
bun run src/index.ts process --csv data.csv --email-column "Contact Email"
```

### `collect` — Collect bounced emails to CSV

```bash
bun run src/index.ts collect
```

Pull all bounced email addresses from your Gmail and save them to a CSV file. Unlike `process`, this doesn't require an input CSV — it just extracts and saves the bounced addresses.

The output CSV has three columns: `email`, `bounce_date`, and `confidence`.

**Options:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--output <path>` | No | `./bounced-emails.csv` | Where to save the output CSV |
| `--credentials <path>` | No | `./client_secret.json` | Path to Google OAuth2 credentials |
| `--since <days>` | No | `30` | How many days back to search for bounces |

**Examples:**

```bash
# Basic usage — saves to ./bounced-emails.csv
bun run src/index.ts collect

# Look back 60 days
bun run src/index.ts collect --since 60

# Save to a specific location
bun run src/index.ts collect --output ~/Desktop/bounces.csv
```

### `auth` — Authenticate with Gmail

```bash
bun run src/index.ts auth --credentials ./client_secret.json
```

Opens your browser for Google OAuth sign-in. Use this on first run or to re-authenticate if your token expires.

### `status` — Check last run info

```bash
bun run src/index.ts status
```

Shows when you last ran the tool and how many bounce messages have been processed total.

## CSV Format

Your CSV needs a header row with a column containing email addresses. The tool auto-detects columns named:
- `email`
- `e-mail`
- `email_address`
- `mail`

If your column has a different name (like `Contact Email`), use `--email-column "Contact Email"`.

All other columns are preserved — the tool only reads the email column for matching, but keeps all your data intact.

## Output Files

When bounces are found:
- Your original CSV is updated with invalid emails removed
- A new `<filename>_invalid.csv` is created (or appended to) with the removed emails

Example: if your input is `contacts.csv`, you'll get:
- `contacts.csv` — cleaned, without bounced emails
- `contacts_invalid.csv` — the bounced emails that were removed

## Re-running

The tool tracks which Gmail messages it has already processed. Running it again will only look at new bounce emails since the last run — it won't re-process old bounces or re-remove emails that were already moved to the invalid file.
