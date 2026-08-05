import { ApiClient, ApiError } from "@gm/api-client";
import { DEMO_WRITE_MESSAGE, demoHeaders, isDemo } from "./demo.js";

/**
 * Session cookie rides along automatically (same origin).
 *
 * The custom `fetch` is the demo tour's client half: while it's on, every
 * request carries the demo header, and anything that isn't a read is refused
 * here rather than at the server. The server refuses it too — that's the
 * actual guarantee — but a 403 from the network is a worse thing to show
 * someone than a sentence explaining that the demo is a demo, and this way
 * every existing error path in the app already says the right thing.
 */
const demoAwareFetch: typeof fetch = (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (isDemo() && method !== "GET" && method !== "HEAD") {
    return Promise.reject(new ApiError(403, DEMO_WRITE_MESSAGE));
  }
  return fetch(input, init);
};

export const api = new ApiClient({
  baseUrl: "",
  fetch: demoAwareFetch,
  getHeaders: demoHeaders,
});
