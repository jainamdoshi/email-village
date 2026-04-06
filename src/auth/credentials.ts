import { readFileSync, existsSync } from "fs";
import path from "path";

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function loadCredentials(credentialsPath: string): ClientCredentials {
  const resolvedPath = path.resolve(credentialsPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Credentials file not found at: ${resolvedPath}\n` +
        "Please download your OAuth2 client credentials from Google Cloud Console\n" +
        "and save them as client_secret.json in your project directory."
    );
  }

  const raw = readFileSync(resolvedPath, "utf-8");
  const json = JSON.parse(raw);

  // Google Cloud Console exports credentials in different formats
  const creds = json.installed || json.web;

  if (!creds) {
    throw new Error(
      "Invalid credentials file format. Expected 'installed' or 'web' key.\n" +
        "Please download OAuth2 credentials (Desktop app type) from Google Cloud Console."
    );
  }

  return {
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    redirectUri: creds.redirect_uris?.[0] || "http://localhost:3000/callback",
  };
}
