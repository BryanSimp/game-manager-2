import type { FastifyInstance } from "fastify";

/**
 * Global XSS defense-in-depth: strip active-content HTML from every
 * user-submitted string before a handler sees it.
 *
 * React escapes text on render, so the primary defense already exists on the
 * output side — this hook is the second layer, keeping script payloads out of
 * the database entirely (they'd otherwise wait there for a future template,
 * email, export, or API consumer that *doesn't* escape). It deliberately does
 * NOT strip all HTML: notes like "boss < 50% hp -> phase 2" must survive
 * untouched, so only constructs that can execute are removed.
 */

/** Elements whose presence is never legitimate in game notes/titles/searches. */
const DANGEROUS_ELEMENT =
  /<\s*\/?\s*(script|iframe|object|embed|style|link|meta|base|form|frameset|frame|applet)\b[^>]*>?/gi;

/** A whole <script>…</script> block, so its body goes too, not just the tags. */
const SCRIPT_BLOCK = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;

/** Anything that still looks like an HTML tag after the element pass. */
const TAG_SPAN = /<[a-z!/][^>]*>/gi;

/** Inside a surviving tag: inline event handlers and javascript: URIs. */
const EVENT_ATTR = /\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URI = /\b(href|src|action|formaction|xlink:href|data)\s*=\s*("|')?\s*javascript:[^"'\s>]*("|')?/gi;

export function sanitizeText(input: string): string {
  // fast path — the overwhelming majority of fields never contain "<"
  if (!input.includes("<")) return input;

  let out = input;
  // re-run until stable so split payloads ("<scr<script>ipt>") can't reassemble
  for (let pass = 0; pass < 5; pass++) {
    const before = out;
    out = out.replace(SCRIPT_BLOCK, "");
    out = out.replace(DANGEROUS_ELEMENT, "");
    out = out.replace(TAG_SPAN, (tag) => tag.replace(EVENT_ATTR, "").replace(JS_URI, ""));
    if (out === before) return out;
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 32) return value;
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  if (value !== null && typeof value === "object" && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) out[key] = sanitizeValue(v, depth + 1);
    return out;
  }
  return value;
}

export function registerSanitizer(app: FastifyInstance): void {
  app.addHook("preValidation", async (request) => {
    // passwords are secrets, not display text — altering one silently breaks
    // the account, so better-auth's routes pass through untouched
    if (request.url.startsWith("/api/auth/")) return;
    if (request.body !== null && typeof request.body === "object") {
      request.body = sanitizeValue(request.body, 0);
    }
    if (request.query !== null && typeof request.query === "object") {
      request.query = sanitizeValue(request.query, 0);
    }
  });
}
