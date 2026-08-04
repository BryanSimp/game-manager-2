import { env } from "../env.js";
import { getSetting } from "./settings.js";

/**
 * Transactional email via Resend's HTTP API (no SDK — one endpoint, plain
 * fetch, same as the IGDB/Steam services). Key and from-address are DB-first
 * with env fallback so the admin can configure them from web Settings.
 *
 * Never log message bodies or URLs from here: reset emails carry live tokens.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Resend's shared test sender — works out of the box but only delivers to the
// Resend account owner's own address; a verified domain replaces it.
const DEFAULT_FROM = "Game Manager <onboarding@resend.dev>";

export interface EmailConfig {
  apiKey: string;
  from: string;
}

export async function getEmailConfig(): Promise<EmailConfig | null> {
  const apiKey = (await getSetting("resend_api_key")) || env.RESEND_API_KEY || "";
  if (!apiKey) return null;
  const from = (await getSetting("email_from")) || env.EMAIL_FROM || DEFAULT_FROM;
  return { apiKey, from };
}

export async function emailConfigured(): Promise<boolean> {
  return (await getEmailConfig()) !== null;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ id: string }> {
  const config = await getEmailConfig();
  if (!config) throw new Error("Email delivery is not configured");
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) {
    let message = `Resend responded ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const body = (await res.json()) as { id: string };
  return { id: body.id };
}

/** Matches the web app's dark zinc/indigo theme, inlined for mail clients. */
export function sendPasswordResetEmail(to: string, resetUrl: string): Promise<{ id: string }> {
  const text = [
    "Someone (hopefully you) asked to reset the password for your Game Manager account.",
    "",
    `Reset it here: ${resetUrl}`,
    "",
    "The link expires in 15 minutes and works once.",
    "If you didn't ask for this, ignore this email — your password is unchanged.",
  ].join("\n");
  const html = `<div style="margin:0 auto;max-width:480px;padding:32px 24px;background-color:#18181b;border:1px solid #27272a;border-radius:16px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e4e4e7">
  <h1 style="margin:0 0 4px;font-size:20px;text-align:center">🎮 Game Manager</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#a1a1aa;text-align:center">Password reset</p>
  <p style="margin:0 0 16px;font-size:14px;line-height:1.5">Someone (hopefully you) asked to reset the password for your Game Manager account.</p>
  <p style="margin:0 0 24px;text-align:center">
    <a href="${resetUrl}" style="display:inline-block;padding:10px 24px;background-color:#4f46e5;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px">Reset password</a>
  </p>
  <p style="margin:0;font-size:12px;line-height:1.5;color:#a1a1aa">The link expires in 15 minutes and works once. If you didn't ask for this, ignore this email — your password is unchanged.</p>
</div>`;
  return sendEmail({ to, subject: "Reset your Game Manager password", html, text });
}
