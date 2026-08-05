/**
 * Read-only demo mode.
 *
 * `/demo` turns this on and the whole app runs against a seeded showcase
 * account — the real pages, the real routes, real data that happens to be
 * invented. There is no second, fake version of the app to keep in step,
 * which is the only version of a demo that survives contact with a changelog.
 *
 * Writes are refused twice, on purpose. The server refuses any demo request
 * that isn't a read (`server.ts`), which is the guarantee; the client refuses
 * them too (`lib/api.ts`) so the message a visitor sees is a sentence about
 * signing up rather than a 403 from the network tab.
 *
 * State lives in sessionStorage rather than a URL param or a cookie: it has
 * to survive in-app navigation, must not survive the tab closing, and must
 * never ride along on a request from a real signed-in session in another tab.
 */

import { useEffect } from "react";
import { authClient } from "./auth.js";

const KEY = "gm_demo";

/** Header the API reads to serve the demo account. */
export const DEMO_HEADER = "x-gm-demo";

export const DEMO_WRITE_MESSAGE =
  "The demo is view-only — create a free account to build a library of your own.";

let active = read();

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    // private mode or a blocked storage partition: the tour still works for
    // the life of the page, it just won't survive a reload
    return false;
  }
}

export function isDemo(): boolean {
  return active;
}

export function startDemo(): void {
  active = true;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* see read() */
  }
}

export function exitDemo(): void {
  active = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* see read() */
  }
}

/** Headers every request carries while the tour is on. */
export function demoHeaders(): Record<string, string> {
  return active ? { [DEMO_HEADER]: "1" } : {};
}

/**
 * Demo mode as the UI should read it: **a real session always wins**.
 *
 * Signing up is the point of the tour, and better-auth's own client doesn't
 * go through our api-client, so nothing about signing in clears the flag on
 * its own. Without this, someone who took the tour and then registered would
 * land on their own empty library wearing a Demo banner, with every write
 * refused — their account, apparently broken. The server already prefers a
 * real session over the demo header; this makes the client agree, and drops
 * the flag so the next reload is clean.
 */
export function useDemoMode(): boolean {
  const { data: session } = authClient.useSession();
  const demo = isDemo();

  useEffect(() => {
    if (session && isDemo()) exitDemo();
  }, [session]);

  return demo && !session;
}
