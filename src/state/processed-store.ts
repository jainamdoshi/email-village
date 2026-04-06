import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import path from "path";
import type { ProcessedState } from "../types.js";

const STATE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".email-bouncer"
);
const STATE_PATH = path.join(STATE_DIR, "processed.json");

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadProcessedState(): Set<string> {
  if (!existsSync(STATE_PATH)) {
    return new Set();
  }

  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state: ProcessedState = JSON.parse(raw);
    return new Set(state.processedMessageIds);
  } catch {
    return new Set();
  }
}

export function saveProcessedState(processedIds: Set<string>): void {
  ensureStateDir();

  const state: ProcessedState = {
    version: 1,
    lastRun: new Date().toISOString(),
    processedMessageIds: Array.from(processedIds),
  };

  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  chmodSync(STATE_PATH, 0o600);
}

export function getLastRunTime(): string | null {
  if (!existsSync(STATE_PATH)) {
    return null;
  }

  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state: ProcessedState = JSON.parse(raw);
    return state.lastRun;
  } catch {
    return null;
  }
}

export function getProcessedCount(): number {
  if (!existsSync(STATE_PATH)) {
    return 0;
  }

  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state: ProcessedState = JSON.parse(raw);
    return state.processedMessageIds.length;
  } catch {
    return 0;
  }
}
