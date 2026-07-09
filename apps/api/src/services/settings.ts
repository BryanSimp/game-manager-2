import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: new Date() },
    });
}

/** DB-first, env fallback — same pattern as v1 so creds can be set in the UI. */
export async function getIgdbCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const clientId = (await getSetting("igdb_client_id")) || process.env.IGDB_CLIENT_ID || "";
  const clientSecret =
    (await getSetting("igdb_client_secret")) || process.env.IGDB_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
