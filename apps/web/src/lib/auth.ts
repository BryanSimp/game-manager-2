import { createAuthClient } from "better-auth/react";

// Same origin in dev (vite proxy) and prod (Traefik path routing).
export const authClient = createAuthClient({
  basePath: "/api/auth",
});
