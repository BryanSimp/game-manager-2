import { z } from "zod";

/**
 * In-app feedback: the thing a user reaches for when something is wrong, or
 * missing, or they just want to say what they think of a feature.
 *
 * Deliberately **not** the contact form (`schemas/contact.ts`). That one is
 * anonymous, lives on the marketing site and relays to an inbox — it exists
 * so a stranger can reach a person. This one is signed in, so it already
 * knows who sent it, and it lands in a table rather than an email: the point
 * is a queue that can be filtered, triaged and exported months later, which
 * an inbox is bad at.
 */

/** What kind of thing is being reported. */
export const FEEDBACK_KINDS = ["bug", "feature_request", "feedback"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Something's broken",
  feature_request: "Feature request",
  feedback: "Feedback on a feature",
};

/**
 * Which part of the app it's about.
 *
 * Free text would be unfilterable and a full route list would be a wall, so
 * this is the app's own nav, roughly. 'other' is always available and is not
 * a failure — it's where the reports that teach us a missing area come from.
 */
export const FEEDBACK_AREAS = [
  "library",
  "collections",
  "progress",
  "consoles",
  "import",
  "steam",
  "friends",
  "dashboard",
  "account",
  "mobile",
  "other",
] as const;
export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

export const FEEDBACK_AREA_LABELS: Record<FeedbackArea, string> = {
  library: "Library",
  collections: "Collections",
  progress: "Progress & lists",
  consoles: "Consoles",
  import: "Import / OCR / barcode",
  steam: "Steam",
  friends: "Friends",
  dashboard: "Dashboard",
  account: "Account & preferences",
  mobile: "Mobile app",
  other: "Something else",
};

/**
 * Triage state. Stored as text rather than a pg enum for the same reason
 * `user_games.status` is — a new state shouldn't need an ALTER TYPE that
 * can't run in the same transaction as the migration that uses it.
 */
export const FEEDBACK_STATUSES = ["new", "planned", "in_progress", "done", "declined"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  declined: "Won't do",
};

export const feedbackSubmissionSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  area: z.enum(FEEDBACK_AREAS),
  subject: z.string().trim().min(3, "Give it a short title").max(140),
  message: z
    .string()
    .trim()
    .min(10, "Please give a bit more detail (at least 10 characters)")
    .max(4000),
});
export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

/** Admin triage write. Both fields optional so status and note can move alone. */
export const feedbackTriageSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).optional(),
    adminNote: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.adminNote !== undefined, {
    message: "Nothing to update",
  });
export type FeedbackTriageInput = z.infer<typeof feedbackTriageSchema>;

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  area: FeedbackArea;
  subject: string;
  message: string;
  status: FeedbackStatus;
  /** admin-only triage note; null for the submitter's own view */
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** who sent it — null on the submitter's own list, and on a deleted account */
  authorName: string | null;
  authorEmail: string | null;
}

/** How the admin queue is filtered and ordered. Every field is optional. */
export interface AdminFeedbackQuery {
  q?: string;
  kind?: FeedbackKind;
  area?: FeedbackArea;
  status?: FeedbackStatus;
  sort?: FeedbackSort;
  limit?: number;
  offset?: number;
}

export const FEEDBACK_SORTS = ["newest", "oldest", "kind", "area", "status"] as const;
export type FeedbackSort = (typeof FEEDBACK_SORTS)[number];

export const FEEDBACK_SORT_LABELS: Record<FeedbackSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  kind: "Kind",
  area: "Area",
  status: "Status",
};

export interface AdminFeedbackPage {
  items: FeedbackItem[];
  /** how many match the filters, before paging */
  total: number;
  /** counts across everything, ignoring the filters — the tiles at the top */
  totals: {
    all: number;
    byStatus: Record<FeedbackStatus, number>;
    byKind: Record<FeedbackKind, number>;
  };
}
