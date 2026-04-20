import type { gmail_v1 } from "googleapis";

export interface BounceRecord {
  messageId: string;
  bouncedEmail: string;
  extractionMethod: ExtractionMethod;
  confidence: Confidence;
  bounceType: "hard" | "soft" | "unknown";
  timestamp: string;
  subject: string;
}

export type ExtractionMethod =
  | "x-failed-recipients"
  | "dsn-final-recipient"
  | "body-regex"
  | "extended-regex";

export type Confidence = "high" | "medium" | "low";

export interface ExtractionResult {
  email: string;
  method: ExtractionMethod;
  confidence: Confidence;
}

export interface CsvRow {
  [column: string]: string;
}

export interface ProcessingResult {
  totalBounces: number;
  newBounces: number;
  matchedInCsv: number;
  movedToInvalid: number;
  notInCsv: number;
  extractionFailures: number;
  failedMessages: Array<{ messageId: string; subject: string }>;
}

export interface CollectResult {
  totalBounces: number;
  newBounces: number;
  uniqueEmails: number;
  extractionFailures: number;
  failedMessages: Array<{ messageId: string; subject: string }>;
}

export interface AppConfig {
  csvPath: string;
  emailColumn?: string;
  sinceDays: number;
  dryRun: boolean;
  credentialsPath: string;
}

export interface ProcessedState {
  version: 1;
  lastRun: string;
  processedMessageIds: string[];
}

export type GmailMessage = gmail_v1.Schema$Message;
export type GmailMessagePart = gmail_v1.Schema$MessagePart;
export type GmailHeader = gmail_v1.Schema$MessagePartHeader;
