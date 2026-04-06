import type { GmailMessage, GmailMessagePart, GmailHeader } from "../types.js";

export function getHeader(
  headers: GmailHeader[] | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value || undefined;
}

export function decodeBase64Url(encoded: string): string {
  // Gmail API uses URL-safe base64
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

export function getPlainTextBody(message: GmailMessage): string {
  const payload = message.payload;
  if (!payload) return "";

  // Simple message with body directly on payload
  if (payload.body?.data) {
    const mimeType = payload.mimeType || "";
    if (mimeType === "text/plain" || mimeType === "text/html") {
      return decodeBase64Url(payload.body.data);
    }
  }

  // Walk MIME parts recursively
  return findTextInParts(payload.parts || []);
}

function findTextInParts(parts: GmailMessagePart[]): string {
  let plainText = "";
  let htmlText = "";

  for (const part of parts) {
    const mimeType = part.mimeType || "";

    if (mimeType === "text/plain" && part.body?.data) {
      plainText += decodeBase64Url(part.body.data);
    } else if (mimeType === "text/html" && part.body?.data) {
      htmlText += decodeBase64Url(part.body.data);
    } else if (part.parts) {
      // Recurse into nested parts
      const nested = findTextInParts(part.parts);
      if (nested) plainText += nested;
    }
  }

  return plainText || htmlText;
}

export function findDeliveryStatusPart(
  message: GmailMessage
): string | undefined {
  const parts = message.payload?.parts || [];
  return findDsnInParts(parts);
}

function findDsnInParts(parts: GmailMessagePart[]): string | undefined {
  for (const part of parts) {
    const mimeType = part.mimeType || "";

    if (mimeType === "message/delivery-status" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    // Some DSN parts are nested inside multipart/report
    if (part.parts) {
      const found = findDsnInParts(part.parts);
      if (found) return found;
    }

    // Sometimes the delivery status is in a text/plain part within multipart/report
    if (
      mimeType === "text/plain" &&
      part.body?.data
    ) {
      const decoded = decodeBase64Url(part.body.data);
      if (
        decoded.includes("Final-Recipient:") ||
        decoded.includes("Original-Recipient:")
      ) {
        return decoded;
      }
    }
  }

  return undefined;
}
