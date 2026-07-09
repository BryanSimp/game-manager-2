import { ApiClient } from "@gm/api-client";

// Session cookie rides along automatically (same origin).
export const api = new ApiClient({ baseUrl: "" });
