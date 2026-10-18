import { z } from "zod";
import { API_KEY_NAME_MAX } from "../constants.js";

/**
 * Personal API keys: what Claude Code (or anything else that speaks MCP)
 * presents to `/api/mcp` to read your library without a browser session.
 *
 * A key is accepted by the MCP endpoint and nowhere else. By default it only
 * reads; `allowChanges` lets it use the MCP server's write tools too (add
 * tags, collections, linked games and time-to-beat figures — nothing that
 * deletes). That's a choice made once, when the key is made, and off unless
 * you tick it: keys made before the option existed are read-only for good.
 * One key per device is the intended shape: revoking the laptop's shouldn't
 * sign the desktop out.
 */
export const apiKeyCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the key a name, like the device it's for")
    .max(API_KEY_NAME_MAX, `Key names are at most ${API_KEY_NAME_MAX} characters`),
  allowChanges: z.boolean().optional(),
});
export type ApiKeyCreateInput = z.input<typeof apiKeyCreateSchema>;

/** A key as the API keys card lists it. The key itself is never in here. */
export interface ApiKeySummary {
  id: string;
  name: string | null;
  /** the first few characters, prefix included, to tell keys apart */
  start: string | null;
  createdAt: string;
  /** null until the key has been used once */
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** whether the key may use the MCP write tools, or only read */
  allowChanges: boolean;
}

/** Returned once, by create. `key` can't be fetched again afterwards. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}

/**
 * An app you've let read your library through OAuth — claude.ai's connector,
 * usually. `name` is whatever the app called itself when it registered, so
 * `redirectHost` (where its sign-ins are sent, which the server checked) is
 * the trustworthy half.
 */
export interface OAuthConnection {
  clientId: string;
  name: string | null;
  uri: string | null;
  redirectHost: string | null;
  scopes: string[];
  connectedAt: string | null;
  /** when it last got a token, which while in use is roughly hourly */
  lastActiveAt: string | null;
}
