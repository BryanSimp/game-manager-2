/**
 * Per-route rate-limit configs, consumed by @fastify/rate-limit via a route's
 * `config` option. The global ceiling (server.ts) stops floods; these protect
 * the routes where one request is expensive — CPU (image re-encode, OCR), an
 * upstream quota (UPCitemdb ~100/day), or an upstream that bans IPs (Fandom
 * sits behind Cloudflare, and one scrape fans out into several wiki fetches).
 */

/** Wiki mission scraping: each call probes multiple Fandom endpoints. */
export const scraperRateLimit = {
  rateLimit: { max: 5, timeWindow: "1 minute" },
};

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

/** Barcode lookups: UPCitemdb's trial tier is ~100/day per IP. */
export const barcodeRateLimit = {
  rateLimit: { max: 10, timeWindow: "1 minute" },
};
