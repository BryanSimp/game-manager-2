import { z } from "zod";
import { USER_ROLES } from "../constants.js";

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;

export const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  time: z.string(),
});
export type Health = z.infer<typeof healthSchema>;
