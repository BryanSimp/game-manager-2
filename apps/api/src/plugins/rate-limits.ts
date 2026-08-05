/**
 * Per-route rate-limit configs, consumed by @fastify/rate-limit via a route's
 * `config` option. The global ceiling (server.ts) stops floods; these protect
 * the routes where one request is expensive — CPU (image re-encode, OCR) or
 * an upstream quota (UPCitemdb ~100/day).
 */

/** Image uploads and server-side image fetches: sharp re-encode per request. */
export const uploadRateLimit = {
  rateLimit: { max: 20, timeWindow: "1 minute" },
};

/** Browsing external art/cover catalogs (SteamGridDB, IGDB, Wikimedia). */
export const externalLookupRateLimit = {
  rateLimit: { max: 30, timeWindow: "1 minute" },
};

/** OCR import jobs: each one occupies a worker for a while. */
export const importRateLimit = {
  rateLimit: { max: 10, timeWindow: "1 minute" },
};

/**
 * Thumbs on public lists and collections. Cheap per call, but it's a write
 * loop anyone can point at someone else's list, so it gets a ceiling well
 * above real use — you can't read and judge sixty lists in a minute.
 */
export const voteRateLimit = {
  rateLimit: { max: 60, timeWindow: "1 minute" },
};

/** Barcode lookups: UPCitemdb's trial tier is ~100/day per IP. */
export const barcodeRateLimit = {
  rateLimit: { max: 10, timeWindow: "1 minute" },
};

/**
 * The public contact form — unauthenticated and it sends mail, so it's the
 * most abusable route in the app. Low ceiling over a long window: nobody
 * legitimately files four support requests in ten minutes.
 */
export const contactRateLimit = {
  rateLimit: { max: 3, timeWindow: "10 minutes" },
};

/**
 * In-app feedback. Signed in, so it's already attributable and doesn't send
 * mail — but it does write rows an admin has to read, so it gets a ceiling
 * roomier than the contact form's and still well under a flood.
 */
export const feedbackRateLimit = {
  rateLimit: { max: 10, timeWindow: "10 minutes" },
};
