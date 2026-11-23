import { google } from "googleapis";
import { GaxiosError } from "gaxios";
import type { OAuth2Client } from "google-auth-library";
import type { GmailMessage } from "../types.js";
import { info } from "../utils/logger.js";

const BATCH_DELAY_MS = 100;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchBounceMessages(
  auth: OAuth2Client,
  query: string,
  maxResults: number = 500
): Promise<string[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const messageIds: string[] = [];
  let pageToken: string | undefined;

  info(`Searching Gmail with query: ${query}`);

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(maxResults - messageIds.length, 500),
      pageToken,
    });

    const messages = response.data.messages || [];
    for (const msg of messages) {
      if (msg.id) {
        messageIds.push(msg.id);
      }
    }

    pageToken = response.data.nextPageToken || undefined;

    if (messageIds.length >= maxResults) {
      break;
    }
  } while (pageToken);

  info(`Found ${messageIds.length} potential bounce messages.`);
  return messageIds;
}

export async function getMessageDetails(
  auth: OAuth2Client,
  messageId: string
): Promise<GmailMessage> {
  const gmail = google.gmail({ version: "v1", auth });

  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  return response.data;
}

export async function fetchMessagesWithDelay(
  auth: OAuth2Client,
  messageIds: string[]
): Promise<GmailMessage[]> {
  const messages: GmailMessage[] = [];

  for (let i = 0; i < messageIds.length; i++) {
    const message = await getMessageDetails(auth, messageIds[i]);
    messages.push(message);

    if (i < messageIds.length - 1) {
      await delay(BATCH_DELAY_MS);
    }

    if ((i + 1) % 50 === 0) {
      info(`Fetched ${i + 1}/${messageIds.length} messages...`);
    }
  }

  return messages;
}

export async function getProfileEmailAddress(
  auth: OAuth2Client
): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth });
  const response = await gmail.users.getProfile({ userId: "me" });
  return response.data.emailAddress || "";
}

const LIST_PAGE_SIZE = 500;
// Gmail allows ~50 metadata gets/sec per user; 5 in flight stays under it.
const MESSAGE_FETCH_CONCURRENCY = 5;
// Abort requests stuck on a dead connection (e.g. after the Mac sleeps).
// gaxios ignores its own `timeout` option under Bun, so this uses an AbortSignal.
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000;
const LIST_PROGRESS_EVERY = 5000;
const FETCH_PROGRESS_EVERY = 1000;
const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded"]);

// googleapis already retries 429/5xx; Gmail also signals rate limits as 403.
function isRateLimitError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const response = (err as { response?: { status?: number; data?: unknown } }).response;
  if (response?.status === 429) {
    return true;
  }
  if (response?.status !== 403) {
    return false;
  }
  const data = response.data as
    | { error?: { errors?: Array<{ reason?: string }> } }
    | undefined;
  return (data?.error?.errors ?? []).some(
    (e) => e.reason !== undefined && RATE_LIMIT_REASONS.has(e.reason)
  );
}

// A GaxiosError with no response failed below HTTP: timeout, reset, refused or DNS.
// Bun's codes differ from Node's (e.g. "ConnectionRefused"), so match the shape, not codes.
function isNetworkError(err: unknown): boolean {
  return err instanceof GaxiosError && err.response === undefined;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = isRateLimitError(err) || isNetworkError(err);
      if (!retryable || attempt >= RETRY_MAX_RETRIES) {
        throw err;
      }
      await delay(RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }
}

/** Lists every message ID in the mailbox (spam and trash excluded). */
export async function listAllMessageIds(
  auth: OAuth2Client,
  query?: string
): Promise<string[]> {
  const gmail = google.gmail({ version: "v1", auth });
  const messageIds: string[] = [];
  let pageToken: string | undefined;
  let nextProgress = LIST_PROGRESS_EVERY;

  do {
    const response = await withRetry(() =>
      gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: LIST_PAGE_SIZE,
        pageToken,
      }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    );

    for (const msg of response.data.messages ?? []) {
      if (msg.id) {
        messageIds.push(msg.id);
      }
    }

    if (messageIds.length >= nextProgress) {
      info(`Listed ${messageIds.length} messages so far...`);
      nextProgress += LIST_PROGRESS_EVERY;
    }

    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return messageIds;
}

/**
 * Fetches only the given headers for each message, a few at a time, and hands
 * each message to `onMessage`. Failed messages are counted, never thrown.
 */
export async function forEachMessageHeaders(
  auth: OAuth2Client,
  messageIds: string[],
  headers: readonly string[],
  onMessage: (message: GmailMessage) => void
): Promise<{ fetched: number; failed: number }> {
  const gmail = google.gmail({ version: "v1", auth });
  let nextIndex = 0;
  let fetched = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < messageIds.length) {
      const id = messageIds[nextIndex++];
      try {
        const response = await withRetry(() =>
          gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: [...headers],
          }, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
        );
        onMessage(response.data);
        fetched++;
      } catch {
        failed++;
      }

      const done = fetched + failed;
      if (done % FETCH_PROGRESS_EVERY === 0) {
        info(`Scanned ${done}/${messageIds.length} messages...`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: MESSAGE_FETCH_CONCURRENCY }, () => worker())
  );

  return { fetched, failed };
}
