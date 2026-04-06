# Email Bouncer

A CLI tool that automatically filters bounced emails from your Gmail inbox and removes invalid addresses from your CSV email lists.

## What it does

You send emails from Gmail. Some bounce back. This tool reads those bounce-back messages, figures out which email addresses are invalid, and removes them from your CSV — so you don't have to do it manually.

## Quick Start

```bash
# Install dependencies
bun install

# Authenticate with Gmail (opens browser)
bun run src/index.ts auth --credentials ./client_secret.json

# Preview what would be removed (safe, no changes made)
bun run src/index.ts process --csv your-emails.csv --dry-run

# Run for real — removes bounced emails from your CSV
bun run src/index.ts process --csv your-emails.csv
```

## Requirements

- [Bun](https://bun.sh/) runtime
- A Google Cloud project with Gmail API enabled
- OAuth2 credentials (`client_secret.json`)

## Documentation

- [Setup Guide](docs/setup.md) — Google Cloud setup and first-run walkthrough
- [Usage Guide](docs/usage.md) — CLI commands, flags, and examples
- [Architecture](docs/architecture.md) — Technical overview for contributors
