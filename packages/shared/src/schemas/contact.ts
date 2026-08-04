import { z } from "zod";

/**
 * Public contact form. Anyone can post this — it's the support address on the
 * marketing pages — so the caps are deliberately tight: the endpoint relays
 * to a fixed operator address, never to an address in the payload.
 */
export const contactMessageSchema = z.object({
  name: z.string().trim().min(1, "Your name is required").max(80),
  email: z.string().trim().email("Enter a valid email address").max(200),
  subject: z.string().trim().min(1, "A subject is required").max(120),
  message: z
    .string()
    .trim()
    .min(20, "Please give us a bit more detail (at least 20 characters)")
    .max(4000),
  /**
   * Honeypot. Real people never see this field, so anything in it is a bot;
   * the endpoint accepts the request and drops it on the floor rather than
   * returning an error a scraper could learn from.
   */
  website: z.string().max(200).optional(),
});
export type ContactMessageInput = z.infer<typeof contactMessageSchema>;
