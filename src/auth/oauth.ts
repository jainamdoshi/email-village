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

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".email-bouncer"
);
const TOKEN_PATH = path.join(TOKEN_DIR, "token.json");
const CALLBACK_PORT = 3000;

function ensureTokenDir(): void {
  if (!existsSync(TOKEN_DIR)) {
    mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadCachedToken(): Record<string, unknown> | null {
  if (!existsSync(TOKEN_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(TOKEN_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveToken(token: Record<string, unknown>): void {
  ensureTokenDir();
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
  chmodSync(TOKEN_PATH, 0o600);
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
  credentialsPath: string
): Promise<OAuth2Client> {
  const creds = loadCredentials(credentialsPath);

  const redirectUri = `http://localhost:${CALLBACK_PORT}/callback`;
  const oauth2Client = new OAuth2Client(
    creds.clientId,
    creds.clientSecret,
    redirectUri
  );

  // Try cached token first
  const cachedToken = loadCachedToken();
  if (cachedToken) {
    oauth2Client.setCredentials(cachedToken);

    const tokenInfo = oauth2Client.credentials;
    if (tokenInfo.refresh_token) {
      // Validate the token actually works before returning
      try {
        await oauth2Client.getAccessToken();
        info("Using cached credentials.");
        return oauth2Client;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);
        if (
          message.includes("invalid_grant") ||
          message.includes("Token has been expired or revoked")
        ) {
          logError(
            "Your Gmail authorization has expired. Re-authenticating..."
          );
          clearCachedToken();
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

  const code = await getCodeFromBrowser(authUrl);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  saveToken(tokens as Record<string, unknown>);
  info("Authentication successful. Token cached.");

  return oauth2Client;
}

export function clearCachedToken(): boolean {
  if (existsSync(TOKEN_PATH)) {
    unlinkSync(TOKEN_PATH);
    return true;
  }
  return false;
}
