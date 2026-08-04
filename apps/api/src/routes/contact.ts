import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { contactMessageSchema } from "@gm/shared";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { emailConfigured, sendEmail } from "../services/email.js";
import { getSetting } from "../services/settings.js";
import { contactRateLimit } from "../plugins/rate-limits.js";

/**
 * The public contact form behind /contact on the marketing site.
 *
 * This is the only unauthenticated route in the app that sends email, so the
 * shape matters: the recipient is resolved **server-side** and never comes
 * from the request. A payload can't name a destination, so this can't be used
 * as an open relay — the worst a flood achieves is filling the operator's
 * inbox, which the rate limit caps at three per ten minutes per IP.
 *
 * The sender's address travels as Reply-To, never as From: From has to stay
 * our own verified domain or the message fails SPF.
 */

/** Escapes text before it goes into the HTML part of the email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Where contact mail lands: an explicit setting, then an env override, then
 * the first admin's own address so the form works on a fresh install with no
 * configuration at all.
 */
async function contactDestination(): Promise<string | null> {
  const configured = (await getSetting("contact_email")) || env.CONTACT_EMAIL;
  if (configured) return configured;

  const [admin] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.role, "admin"))
    .orderBy(asc(schema.user.createdAt))
    .limit(1);
  return admin?.email ?? null;
}

// One reply for delivered and honeypot-dropped alike — a bot shouldn't be able
// to tell that it was caught.
const ACCEPTED = {
  ok: true as const,
  message: "Thanks — your message is on its way. We'll reply to the address you gave.",
};

export function registerContactRoutes(app: FastifyInstance): void {
  app.post("/api/contact", { config: contactRateLimit }, async (request, reply) => {
    const parsed = contactMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: parsed.error.issues[0]?.message });
    }
    const { name, email, subject, message, website } = parsed.data;

    // Honeypot filled → a bot. Accept and discard.
    if (website && website.trim()) return ACCEPTED;

    if (!(await emailConfigured())) {
      return reply.status(503).send({
        message:
          "The contact form isn't set up on this server yet — an admin needs to add a Resend key in Settings.",
      });
    }

    const to = await contactDestination();
    if (!to) {
      return reply
        .status(503)
        .send({ message: "There's no contact address configured on this server yet." });
    }

    const text = [
      `From: ${name} <${email}>`,
      `Subject: ${subject}`,
      "",
      message,
      "",
      "— sent from the Game Manager contact form",
    ].join("\n");

    const html = `<div style="margin:0 auto;max-width:560px;padding:24px;background-color:#18181b;border:1px solid #27272a;border-radius:16px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#e4e4e7">
  <p style="margin:0 0 4px;font-size:12px;color:#a1a1aa">Contact form</p>
  <h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(subject)}</h1>
  <p style="margin:0 0 16px;font-size:13px;color:#a1a1aa">From ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
  <div style="padding:16px;background-color:#27272a;border-radius:12px;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(message)}</div>
</div>`;

    try {
      await sendEmail({
        to,
        subject: `[Contact] ${subject}`,
        html,
        text,
        replyTo: email,
      });
    } catch (err) {
      request.log.error({ err }, "contact form delivery failed");
      return reply
        .status(502)
        .send({ message: "We couldn't send that just now — please try again in a few minutes." });
    }

    return ACCEPTED;
  });
}
