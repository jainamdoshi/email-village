import { google } from "googleapis";
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
