import { ApiClient } from "@gm/api-client";
import { authClient } from "./auth";
import { API_URL } from "./config";

// The expo plugin stores the session cookie in SecureStore;
// attach it to our own API requests.
export const api = new ApiClient({
  baseUrl: API_URL,
  getHeaders: () => {
    const headers: Record<string, string> = {};
    const cookie = authClient.getCookie();
    if (cookie) headers.cookie = cookie;
    return headers;
  },
});
