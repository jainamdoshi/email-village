# Email Bouncer

## Project Overview
A TypeScript CLI tool that automates filtering bounced emails from Gmail and cleaning CSV email lists.

## Tech Stack
- **Runtime & Package Manager:** Bun
- **Language:** TypeScript (strict mode)
- **Testing:** Bun's built-in test runner (`bun test`)
- **Gmail API:** googleapis + google-auth-library
- **CLI:** commander

## Commands
- `bun run src/index.ts process --csv <file>` — Process bounces and update CSV
- `bun run src/index.ts auth` — Authenticate with Gmail
- `bun run src/index.ts status` — Show last run status
- `bun test` — Run all tests
- `bun run typecheck` — Run TypeScript type checking

## Code Standards
- Use strict TypeScript — no `any` types, all functions typed
- Use `import`/`export` (ESM), not `require`
- Prefer named exports over default exports
- Error messages should be user-friendly (this is a PM's tool, not a developer's)
- Never log sensitive data (tokens, credentials, full email contents)
- All file paths use `path.join()` or `path.resolve()` — no string concatenation
- CSV operations must preserve all original columns
- Bounce parsing must never crash — log failures and continue

## Testing
- Test files: `test/**/*.test.ts`
- Use `describe`/`it`/`expect` from `bun:test`
- Bounce parser tests must use fixture files in `test/fixtures/`
- Mock Gmail API responses for integration tests — never hit real API in tests

## Security
- OAuth tokens stored in `~/.email-bouncer/` with `0o600` permissions
- `credentials/` directory is gitignored — never commit secrets
- Gmail scope is `gmail.readonly` — read-only access only

## Architecture
- `src/auth/` — OAuth2 authentication
- `src/gmail/` — Gmail API client
- `src/parser/` — Bounce email parsing (4-layer pipeline)
- `src/csv/` — CSV read/write operations
- `src/state/` — Processed message tracking
- `src/utils/` — Shared utilities
- `src/types.ts` — Shared TypeScript interfaces
