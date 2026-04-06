# Setup Guide

This guide walks you through setting up Email Bouncer from scratch. You'll need a Google account (Gmail or Google Workspace) and about 10 minutes.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top of the page, then click **New Project**
3. Name it something like `email-bouncer` and click **Create**
4. Make sure this new project is selected in the dropdown

## Step 2: Enable the Gmail API

1. In the left sidebar, go to **APIs & Services** > **Library**
2. Search for **Gmail API**
3. Click on it and press **Enable**

## Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** user type (or **Internal** if you're on Google Workspace and only you will use it)
3. Fill in the required fields:
   - **App name**: `Email Bouncer`
   - **User support email**: your email
   - **Developer contact**: your email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes**
   - Search for `Gmail API` and check `gmail.readonly` (`https://www.googleapis.com/auth/gmail.readonly`)
   - Click **Update**, then **Save and Continue**
6. On the **Test users** page, click **Add Users** and add your Gmail address
7. Click **Save and Continue**, then **Back to Dashboard**

## Step 4: Create OAuth2 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Choose **Desktop app** as the application type
4. Name it `Email Bouncer CLI`
5. Click **Create**
6. A dialog will show your Client ID and Client Secret — click **Download JSON**
7. Save the downloaded file as `client_secret.json` in your project root directory

## Step 5: Install Dependencies

```bash
bun install
```

## Step 6: Authenticate

Run the auth command — it will open your browser for Google sign-in:

```bash
bun run src/index.ts auth --credentials ./client_secret.json
```

1. Your browser will open to Google's consent page
2. Sign in with the Gmail account that receives the bounce emails
3. Click **Allow** to grant read-only access
4. You'll see "Authorization successful!" in the browser — you can close that tab
5. The terminal will confirm: `Authentication successful. Token cached.`

Your token is now cached at `~/.email-bouncer/token.json`. You won't need to re-authenticate unless the token expires or is revoked.

## Step 7: Run Your First Scan

```bash
bun run src/index.ts process --csv your-emails.csv --dry-run
```

The `--dry-run` flag shows what would be removed without actually modifying your files. Once you're happy with the results, run without `--dry-run`:

```bash
bun run src/index.ts process --csv your-emails.csv
```

## Troubleshooting

### "Credentials file not found"
Make sure `client_secret.json` is in your project root, or specify the path with `--credentials /path/to/file.json`.

### "Access blocked: This app's request is invalid"
You may need to add your email as a test user in the OAuth consent screen (Step 3.6 above).

### "Could not start callback server on port 3000"
Another application is using port 3000. Close it and try again.

### "Token has been expired or revoked"
Run `bun run src/index.ts auth` to re-authenticate.
