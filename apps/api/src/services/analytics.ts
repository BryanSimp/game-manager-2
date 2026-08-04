import { db, schema } from "../db/index.js";

/**
 * Fire-and-forget behavioral event log. Events buffer in memory and flush as
 * one batched insert on a timer, so logging costs a request only an array
 * push — never a database round-trip, and never an error: a failed flush is
 * dropped, because telemetry must not break the app it measures.
 */

export type AnalyticsEventType =
  | "sign_up"
  | "steam_link"
  | "game_added"
  | "collection_created"
  | "activity"
  // a write rejected by services/content-filter.ts — worth watching, both to
  // catch abuse and to notice the filter rejecting things it shouldn't
  | "content_blocked"
  | "scrape";

/**
 * External sources the app fetches from — the system-health view groups by
 * this. 'missions' is gone (the Fandom scraper was removed in phase 16); the
 * admin chart groups by the stored value, so historical rows still render.
 */
export type ScrapeSource =
  | "boxart"
  | "upc"
  | "console_art"
  | "steam_import"
  | "steam_sync"
  | "ocr";

interface PendingEvent {
  userId: string | null;
  type: AnalyticsEventType;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT = 200; // a burst flushes early instead of waiting for the timer
const MAX_BUFFER = 5_000; // beyond this, shed events rather than grow memory

let buffer: PendingEvent[] = [];
let flushing = false;
let timer: NodeJS.Timeout | null = null;

export function logEvent(
  type: AnalyticsEventType,
  userId: string | null,
  meta?: Record<string, unknown>,
): void {
  if (buffer.length >= MAX_BUFFER) return;
  buffer.push({ userId, type, meta: meta ?? null, createdAt: new Date() });
  if (buffer.length >= FLUSH_AT) {
    void flushEvents();
  } else if (!timer) {
    timer = setInterval(() => void flushEvents(), FLUSH_INTERVAL_MS);
    // never keep the process alive just to write telemetry
    timer.unref();
  }
}

/** Outcome of one external fetch (box art repo, UPC db, Steam API…). */
export function logScrape(source: ScrapeSource, ok: boolean, detail?: string): void {
  logEvent("scrape", null, { source, ok, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
}

export async function flushEvents(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];
  try {
    await db.insert(schema.analyticsEvents).values(batch);
  } catch {
    // dropped by design — see module comment
  } finally {
    flushing = false;
  }
}
