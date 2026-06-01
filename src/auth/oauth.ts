import { OAuth2Client } from "google-auth-library";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
} from "fs";
import path from "path";
import { createServer } from "http";
import open from "open";
import { loadCredentials } from "./credentials.js";
import { info, error as logError } from "../utils/logger.js";
import { getProfileEmailAddress } from "../gmail/client.js";
import { normalizeEmail } from "../utils/email-normalize.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".email-bouncer"
);
const TOKEN_PATH = path.join(TOKEN_DIR, "token.json");
const TOKENS_DIR = path.join(TOKEN_DIR, "tokens");
const CALLBACK_PORT = 3000;

function tokenPathForAccount(account: string): string {
  return path.join(TOKENS_DIR, `${account}.json`);
}

function loadCachedToken(tokenPath: string): Record<string, unknown> | null {
  if (!existsSync(tokenPath)) {
    return null;
  }
  try {
    const raw = readFileSync(tokenPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToken(token: Record<string, unknown>, tokenPath: string): void {
  const dir = path.dirname(tokenPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeFileSync(tokenPath, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

async function getCodeFromBrowser(authUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "", `http://localhost:${CALLBACK_PORT}`);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization failed</h1><p>You can close this window.</p>"
        );
        server.close();
        reject(new Error(`Authorization error: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>"
        );
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(CALLBACK_PORT, () => {
      info("Opening browser for Google authorization...");
      open(authUrl).catch(() => {
        info(`Could not open browser. Please visit this URL manually:\n${authUrl}`);
      });
    });

    server.on("error", (err) => {
      reject(
        new Error(
          `Could not start callback server on port ${CALLBACK_PORT}: ${err.message}`
        )
      );
    });
  });
}

export async function getAuthenticatedClient(
  credentialsPath: string,
  account?: string
): Promise<OAuth2Client> {
  const creds = loadCredentials(credentialsPath);
  const tokenPath = account ? tokenPathForAccount(account) : TOKEN_PATH;

  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`;
  const oauth2Client = new OAuth2Client(
    creds.clientId,
    creds.clientSecret,
    redirectUri
  );

  // Try cached token first
  const cachedToken = loadCachedToken(tokenPath);
  if (cachedToken) {
    oauth2Client.setCredentials(cachedToken);

    if (oauth2Client.credentials.refresh_token) {
      // Validate the token actually works before returning
      try {
        await oauth2Client.getAccessToken();
        info(
          account
            ? `Using cached credentials for ${account}.`
            : "Using cached credentials."
        );
        return oauth2Client;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        if (
          message.includes("invalid_grant") ||
          message.includes("Token has been expired or revoked")
        ) {
          logError(
            account
              ? `Authorization for ${account} expired. Re-authenticating...`
              : "Your Gmail authorization has expired. Re-authenticating..."
          );
          clearCachedToken(tokenPath);
          // Fall through to browser auth flow below
        } else {
          throw err;
        }
      }
    }
  }

  // No cached token — run browser auth flow
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  if (account) {
    info(`Sign in as ${account} in the browser window that opens.`);
  }

  const code = await getCodeFromBrowser(authUrl);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // When an account is expected, verify the signed-in identity before saving.
  if (account) {
    const actual = await getProfileEmailAddress(oauth2Client);
    if (normalizeEmail(actual) !== normalizeEmail(account)) {
      throw new Error(
        `Signed in as ${actual}, but expected ${account}. ` +
          `Token not saved — re-run and sign in with the correct account.`
      );
    }
  }

  saveToken(tokens as Record<string, unknown>, tokenPath);
  info(
    account
      ? `Authentication successful for ${account}. Token cached.`
      : "Authentication successful. Token cached."
  );

  return oauth2Client;
}

export function clearCachedToken(tokenPath: string = TOKEN_PATH): boolean {
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
    return true;
  }
  return false;
}
