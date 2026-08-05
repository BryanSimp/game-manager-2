import { useEffect } from "react";
import { authClient } from "./auth.js";

/**
 * Demo modes. There are two, and they are opposites.
 *
 * **tour** — `/demo`. The whole app runs against a seeded showcase account
 * for a signed-out visitor. Reads only; every write is refused twice, by the
 * server (`server.ts`) and again here so the message is a sentence about
 * signing up rather than a 403 from the network tab.
 *
 * **edit** — an admin curating that same account from `/admin/demo`. Writes
 * are allowed, because the point is to change what visitors will see. The
 * app is the editor: there's no bespoke demo-content CRUD, just the ordinary
 * Library, Collections and Progress screens pointed at the demo's data.
 *
 * They use different headers so a request can never be both, and the
 * view-only hook on the server keys on the tour's. Edit mode is additionally
 * gated on the requester actually being an admin, server-side — the header
 * alone does nothing.
 *
 * State lives in sessionStorage rather than a URL param or a cookie: it has
 * to survive in-app navigation, must not survive the tab closing, and must
 * never ride along on a request from a real signed-in session in another tab.
 */

const KEY = "gm_demo";

export const DEMO_HEADER = "x-gm-demo";
export const DEMO_EDIT_HEADER = "x-gm-demo-edit";

export const DEMO_WRITE_MESSAGE =
  "The demo is view-only — create a free account to build a library of your own.";

export type DemoMode = "tour" | "edit" | null;

let mode: DemoMode = read();

function read(): DemoMode {
  try {
    const value = sessionStorage.getItem(KEY);
    return value === "tour" || value === "edit" ? value : null;
  } catch {
    // private mode or a blocked storage partition: the mode still works for
    // the life of the page, it just won't survive a reload
    return null;
  }
}

function write(next: DemoMode): void {
  mode = next;
  try {
    if (next) sessionStorage.setItem(KEY, next);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* see read() */
  }
}

export function demoMode(): DemoMode {
  return mode;
}

/** True only for the read-only visitor tour, which is what blocks writes. */
export function isDemo(): boolean {
  return mode === "tour";
}

export function isDemoEdit(): boolean {
  return mode === "edit";
}

export function startDemo(): void {
  write("tour");
}

export function startDemoEdit(): void {
  write("edit");
}

export function exitDemo(): void {
  write(null);
}

/** Headers every request carries while a demo mode is on. */
export function demoHeaders(): Record<string, string> {
  if (mode === "tour") return { [DEMO_HEADER]: "1" };
  if (mode === "edit") return { [DEMO_EDIT_HEADER]: "1" };
  return {};
}

/**
 * The visitor tour as the UI should read it: **a real session always wins**.
 *
 * Signing up is the point of the tour, and better-auth's own client doesn't
 * go through our api-client, so nothing about signing in clears the flag on
 * its own. Without this, someone who took the tour and then registered would
 * land on their own empty library wearing a Demo banner, with every write
 * refused — their account, apparently broken. The server already prefers a
 * real session over the demo header; this makes the client agree, and drops
 * the flag so the next reload is clean.
 *
 * Edit mode is exempt: it *requires* a session, and ending it is a deliberate
 * click on the banner rather than something signing in should undo.
 */
export function useDemoMode(): boolean {
  const { data: session } = authClient.useSession();
  const tour = isDemo();

  useEffect(() => {
    if (session && isDemo()) exitDemo();
  }, [session]);

  return tour && !session;
}
