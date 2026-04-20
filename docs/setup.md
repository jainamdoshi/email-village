# Setup Guide

This guide walks you through setting up Email Bouncer from scratch. You'll need about 10 minutes.

## Understanding the Two Accounts

Email Bouncer involves two Google accounts that can be different:

| | Account A (Admin Account) | Account B (Email Account) |
|---|---|---|
| **What it does** | Owns the Google Cloud project and API credentials | The Gmail that sends emails and receives bounces |
| **Example** | Your personal Gmail or IT admin account | Your work email (e.g. jainam.doshi@clinibase.com) |
| **Used when** | Steps 1–4 (one-time setup) | Step 6 (authentication) and daily use |

**These can be the same account** if you prefer — the steps are identical either way.

---

## Account A: One-Time API Setup

> Log into [Google Cloud Console](https://console.cloud.google.com/) with **Account A** for Steps 1–4.

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top of the page, then click **New Project**
3. Name it something like `email-bouncer` and click **Create**
4. Make sure this new project is selected in the dropdown

### Step 2: Enable the Gmail API

1. In the left sidebar, go to **APIs & Services** > **Library**
2. Search for **Gmail API**
3. Click on it and press **Enable**

### Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** user type (or **Internal** if you're on Google Workspace and only your organization will use it)
3. Fill in the required fields:
   - **App name**: `Email Bouncer`
   - **User support email**: Account A's email
   - **Developer contact**: Account A's email
4. Click **Save and Continue**
5. On the **Scopes** page, click **Add or Remove Scopes**
   - Search for `Gmail API` and check `gmail.readonly` (`https://www.googleapis.com/auth/gmail.readonly`)
   - Click **Update**, then **Save and Continue**
6. On the **Test users** page, click **Add Users** and add **Account B's email address** (the Gmail that receives bounces)
   - If Account A and Account B are the same, just add that one email
   - You can add multiple email addresses if needed
7. Click **Save and Continue**, then **Back to Dashboard**

> **Important:** While your app is in "Testing" mode, only emails listed as test users (Step 3.6) can authenticate. If you skip this step, Account B will get an "Access blocked" error.

### Step 4: Create OAuth2 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Choose **Desktop app** as the application type
4. Name it `Email Bouncer CLI`
5. Click **Create**
6. A dialog will show your Client ID and Client Secret — click **Download JSON**
7. Save the downloaded file as `client_secret.json` in your project root directory

> You're done with Account A! The remaining steps use Account B.

---

## Account B: Authentication and Daily Use

> From here on, you'll use **Account B** — the Gmail account that sends emails and receives bounces.

### Step 5: Install Dependencies

```bash
bun install
```

### Step 6: Authenticate with Account B

Run the auth command — it will open your browser for Google sign-in:

```bash
bun run src/index.ts auth --credentials ./client_secret.json
```

1. Your browser will open to Google's consent page
2. **Sign in with Account B** — the Gmail account that receives the bounce emails
   - Do NOT sign in with Account A (unless they're the same account)
3. You may see a "Google hasn't verified this app" warning — click **Continue** (this is normal for apps in testing mode)
4. Click **Allow** to grant read-only access
5. You'll see "Authorization successful!" in the browser — you can close that tab
6. The terminal will confirm: `Authentication successful. Token cached.`

Your token is now cached at `~/.email-bouncer/token.json`. You won't need to re-authenticate unless the token expires or is revoked.

### Step 7: Run Your First Scan

```bash
bun run src/index.ts process --csv your-emails.csv --dry-run
```

The `--dry-run` flag shows what would be removed without actually modifying your files. Once you're happy with the results, run without `--dry-run`:

```bash
bun run src/index.ts process --csv your-emails.csv
```

---

## Google Workspace Note

If Account B is a Google Workspace email (like `you@yourcompany.com`), there's one extra consideration:

- If Account A's Google Cloud project is **outside** the Workspace organization, the Workspace admin may need to allow external OAuth apps under **Admin Console** > **Security** > **API Controls**
- **Easier option:** Have someone with access to the Workspace admin console create the Google Cloud project (Account A) within the same organization — this avoids any third-party app restrictions

---

## Troubleshooting

### "Credentials file not found"
Make sure `client_secret.json` is in your project root, or specify the path with `--credentials /path/to/file.json`.

### "Access blocked: This app's request is invalid"
Account B is not listed as a test user. Go back to Step 3.6 and add Account B's email address in the OAuth consent screen.

### "Access blocked" for a Google Workspace email
Your Workspace admin may need to allow the app. See the [Google Workspace Note](#google-workspace-note) above.

### "Google hasn't verified this app" warning
This is normal while the app is in testing mode. Click **Continue** to proceed. This warning only appears for test users you've added.

### "Could not start callback server on port 3000"
Another application is using port 3000. Close it and try again.

### "Token has been expired or revoked"
Run `bun run src/index.ts auth` to re-authenticate with Account B.
